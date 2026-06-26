from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List
import json
from app.db import get_db, rows_to_list, row_to_dict, parse_json_fields
from app.transcript import extract_youtube_id, fetch_video_metadata, fetch_transcript, extract_keywords

router = APIRouter(prefix="/api/videos", tags=["videos"])


class VideoAdd(BaseModel):
    url: str
    playlist_id: int


class VideoUpdate(BaseModel):
    title: Optional[str] = None
    tags_json: Optional[List[str]] = None


@router.get("")
def list_videos(playlist_id: Optional[int] = None, search: Optional[str] = None,
                duration: Optional[str] = None, tag: Optional[str] = None,
                dur_min: Optional[int] = None, dur_max: Optional[int] = None,
                order: Optional[str] = None, order_dir: Optional[str] = None):
    conn = get_db()
    query = """
        SELECT DISTINCT v.*, GROUP_CONCAT(t.name, ',') as tag_names
        FROM videos v
        LEFT JOIN video_tags vt ON vt.video_id = v.id
        LEFT JOIN tags t ON t.id = vt.tag_id
        WHERE 1=1
    """
    params = []
    if playlist_id:
        query += " AND v.playlist_id = ?"
        params.append(playlist_id)
    if search:
        query += " AND (v.title LIKE ? OR v.semantic_tags_json LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])
    if duration == "short":
        query += " AND v.duration_seconds < 600"
    elif duration == "medium":
        query += " AND v.duration_seconds BETWEEN 600 AND 1800"
    elif duration == "long":
        query += " AND v.duration_seconds > 1800"
    elif duration == "custom":
        if dur_min is not None:
            query += " AND v.duration_seconds >= ?"
            params.append(dur_min * 60)
        if dur_max is not None:
            query += " AND v.duration_seconds <= ?"
            params.append(dur_max * 60)
    if tag:
        query += " AND t.name = ?"
        params.append(tag)
    dir_sql = 'ASC' if order_dir == 'asc' else 'DESC'
    order_map = {
        'title': f'v.title {dir_sql}',
        'duration': f'v.duration_seconds {dir_sql}',
        'added_at': f'v.added_at {dir_sql}',
    }
    order_clause = order_map.get(order, f'v.added_at DESC')
    query += f" GROUP BY v.id ORDER BY {order_clause}"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    result = []
    for r in rows:
        d = row_to_dict(r)
        d = parse_json_fields(d, ["tags_json", "transcript_json"])
        result.append(d)
    return result


@router.post("", status_code=201)
def add_video(body: VideoAdd, background_tasks: BackgroundTasks):
    youtube_id = extract_youtube_id(body.url)
    if not youtube_id:
        raise HTTPException(400, "Could not extract YouTube ID from URL")

    conn = get_db()
    playlist = conn.execute("SELECT id FROM playlists WHERE id = ?", (body.playlist_id,)).fetchone()
    if not playlist:
        conn.close()
        raise HTTPException(404, "Playlist not found")

    existing = conn.execute(
        "SELECT id FROM videos WHERE youtube_id = ? AND playlist_id = ?",
        (youtube_id, body.playlist_id)
    ).fetchone()
    if existing:
        conn.close()
        raise HTTPException(409, "Video already in playlist")

    thumbnail = f"https://img.youtube.com/vi/{youtube_id}/mqdefault.jpg"
    cur = conn.execute(
        "INSERT INTO videos (playlist_id, url, youtube_id, title, thumbnail) VALUES (?, ?, ?, ?, ?)",
        (body.playlist_id, body.url, youtube_id, "Loading...", thumbnail),
    )
    video_id = cur.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone()
    conn.close()

    background_tasks.add_task(_enrich_video, video_id, youtube_id)

    result = row_to_dict(row)
    result = parse_json_fields(result, ["tags_json", "transcript_json"])
    return result


def _enrich_video(video_id: int, youtube_id: str):
    """Background task: fetch metadata, transcript, extract keywords."""
    meta = fetch_video_metadata(youtube_id)
    transcript = fetch_transcript(youtube_id)
    keywords = extract_keywords(transcript) if transcript else []

    conn = get_db()
    conn.execute(
        "UPDATE videos SET title=?, duration_seconds=?, thumbnail=?, channel=?, transcript_json=?, tags_json=?, chapters_json=? WHERE id=?",
        (
            meta.get("title", ""),
            meta.get("duration_seconds", 0),
            meta.get("thumbnail", f"https://img.youtube.com/vi/{youtube_id}/mqdefault.jpg"),
            meta.get("channel", ""),
            json.dumps(transcript),
            json.dumps(keywords),
            json.dumps(meta.get("chapters", [])),
            video_id,
        ),
    )
    # Insert keyword tags
    for kw in keywords[:10]:
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (kw,))
        tag_row = conn.execute("SELECT id FROM tags WHERE name = ?", (kw,)).fetchone()
        if tag_row:
            conn.execute(
                "INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)",
                (video_id, tag_row["id"]),
            )
    conn.commit()
    conn.close()
    # Auto-queue download after enrichment
    try:
        from app.routes.downloads import enqueue_download
        enqueue_download(video_id)
    except Exception:
        pass
    # Auto-generate semantic tags in background
    try:
        import threading
        row2 = get_db().execute("SELECT youtube_id FROM videos WHERE id=?", (video_id,)).fetchone()
        if row2:
            ytid = row2["youtube_id"]
            threading.Thread(target=_generate_semantic_tags_bg, args=(ytid,), daemon=True).start()
    except Exception:
        pass
    # Auto-generate video segments in background
    try:
        from app.routes.segments import _generate_segments_bg
        threading.Thread(target=_generate_segments_bg, args=(video_id, youtube_id), daemon=True).start()
    except Exception:
        pass


def _generate_semantic_tags_bg(youtube_id: str):
    """Background: generate semantic tags via Ollama and cache in DB."""
    try:
        import urllib.request as _ureq, re as _re
        conn = get_db()
        row = conn.execute(
            "SELECT semantic_tags_json, transcript_json FROM videos WHERE youtube_id=?",
            (youtube_id,)
        ).fetchone()
        conn.close()
        if not row or (row["semantic_tags_json"] and row["semantic_tags_json"] != "[]"):
            return  # already done or no video

        transcript = []
        if row["transcript_json"] and row["transcript_json"] != "[]":
            try: transcript = json.loads(row["transcript_json"])
            except Exception: pass
        if not transcript:
            transcript = fetch_transcript(youtube_id)
        if not transcript:
            return

        sample = " ".join(e["text"] for e in transcript)[:3000]
        prompt = (
            f"Analyze this video transcript and extract learning metadata.\n"
            f"Transcript:\n{sample}\n\n"
            f"Return ONLY this JSON:\n"
            f'{{"tags": ["tag1", "tag2", "tag3"], "learning_type": "project_tutorial"}}\n\n'
            f"tags: 3-5 specific technical concepts, lowercase 2-4 words.\n"
            f"learning_type: project_tutorial | concept_explainer | tips_tricks | comparison | showcase"
        )
        payload = json.dumps({"model": "gemma3:4b", "prompt": prompt, "stream": False,
                               "options": {"temperature": 0.1, "num_predict": 120}}).encode()
        req = _ureq.Request("http://localhost:11434/api/generate",
            data=payload, headers={"Content-Type": "application/json"}, method="POST")
        with _ureq.urlopen(req, timeout=30) as resp:
            raw = json.loads(resp.read()).get("response", "").strip()
            m = _re.search(r'\{.*\}', raw, _re.DOTALL)
            if m:
                parsed = json.loads(m.group())
                tags = parsed.get("tags", [])[:5]
                lt = parsed.get("learning_type", "")
                valid = {"project_tutorial","concept_explainer","tips_tricks","comparison","showcase"}
                conn2 = get_db()
                conn2.execute("UPDATE videos SET semantic_tags_json=?, learning_type=? WHERE youtube_id=?",
                              (json.dumps(tags), lt if lt in valid else None, youtube_id))
                conn2.commit()
                conn2.close()
    except Exception:
        pass


@router.get("/transcript_raw")
def get_transcript_raw(youtube_id: str):
    """Return transcript by youtube_id — checks DB first, fetches live if missing."""
    conn = get_db()
    row = conn.execute(
        "SELECT transcript_json FROM videos WHERE youtube_id = ?", (youtube_id,)
    ).fetchone()
    conn.close()
    if row and row["transcript_json"] and row["transcript_json"] != "[]":
        try:
            t = json.loads(row["transcript_json"])
            if t:
                return t
        except Exception:
            pass
    return fetch_transcript(youtube_id)


@router.get("/density")
def get_density(youtube_id: str, buckets: int = 40):
    """Bloom's Taxonomy density heatmap.

    Weights transcript phrases by cognitive level:
    - Goal announcements (x4): "we're going to build", "let's create"
    - Create/Evaluate (x3): build, construct, generate, combine, design, decide, compare
    - Analyse (x2): examine, break down, notice, the reason, difference
    - Apply (x1): use, execute, demonstrate, solve
    - Questions (x2, only when Create/Apply absent): talking-head conceptual sections
    - Low-level verbs (click, press, select): ignored
    """
    import re
    transcript = fetch_transcript(youtube_id)
    if not transcript:
        return []
    total_duration = max((e.get("start", 0) + e.get("duration", 0) for e in transcript), default=0)
    if total_duration <= 0:
        return []

    # Goal announcements — highest signal, marks start of a new objective
    goal_re = re.compile(
        r"\b(we(?:'re| are) going to|let(?:'s| us) (?:build|create|make|design|construct|add|generate|combine|set up|explore|see how)"
        r"|i(?:'m| am) going to|i want to (?:show|build|create|make|demonstrate)"
        r"|in this (?:section|chapter|part|video|tutorial)|the goal is|what we(?:'re| are) (?:building|making|creating))\b",
        re.I
    )

    # Bloom's Create + Evaluate (weight 3)
    create_re = re.compile(
        r"\b(build|construct|generate|combine|design|formulate|produce|assemble|compose|synthesise|synthesize"
        r"|decide|choose between|compare|contrast|justify|evaluate|critique|which is better|instead of)\b",
        re.I
    )

    # Bloom's Analyse (weight 2)
    analyse_re = re.compile(
        r"\b(examine|inspect|break(?:ing)? down|notice (?:that|how)|the reason|because of|difference between"
        r"|why (?:does|is|this|we)|how (?:does|this) work|what (?:this|that) (?:does|means)|underneath)\b",
        re.I
    )

    # Bloom's Apply (weight 1)
    apply_re = re.compile(
        r"\b(apply|use (?:this|that|the)|execute|implement|demonstrate|solve|calculate|complete|produce)\b",
        re.I
    )

    # Questions — only meaningful in conceptual (talking-head) sections
    question_re = re.compile(r'\?')
    question_start_re = re.compile(
        r'^(what|how|why|when|where|which)\b', re.I
    )

    bucket_size = total_duration / buckets
    bloom_counts = [0] * buckets     # weighted Bloom score
    question_counts = [0] * buckets  # raw question count
    samples = [[] for _ in range(buckets)]

    for entry in transcript:
        start = entry.get("start", 0)
        text = entry.get("text", "").strip()
        idx = min(int(start / bucket_size), buckets - 1)

        score = 0
        matched_text = None

        if goal_re.search(text):
            score += 4
            matched_text = text
        if create_re.search(text):
            score += 3
            if not matched_text:
                matched_text = text
        if analyse_re.search(text):
            score += 2
            if not matched_text:
                matched_text = text
        # Apply (weight 1) only if combined with another signal, not standalone
        if apply_re.search(text) and score > 0:
            score += 1

        bloom_counts[idx] += score
        if matched_text and len(samples[idx]) < 2:
            samples[idx].append(matched_text.strip())

        # Track questions separately
        if (question_re.search(text) and len(text) > 15) or \
           (question_start_re.match(text) and len(text) > 20):
            question_counts[idx] += 1

    # Talking-head detection: window has questions but low Bloom score
    # In those buckets, substitute question signal
    final_counts = [0] * buckets
    final_samples = [[] for _ in range(buckets)]
    for i in range(buckets):
        if bloom_counts[i] > 0:
            final_counts[i] = bloom_counts[i]
            final_samples[i] = samples[i]
        elif question_counts[i] > 0:
            # Conceptual section — use question signal at reduced weight
            final_counts[i] = question_counts[i]

    # Smooth with immediate neighbours only, no spreading
    smoothed = [0.0] * buckets
    for i in range(buckets):
        # Only include self and direct neighbours that also have signal
        vals = [final_counts[i]]
        if i > 0 and final_counts[i-1] > 0:
            vals.append(final_counts[i-1] * 0.4)
        if i < buckets-1 and final_counts[i+1] > 0:
            vals.append(final_counts[i+1] * 0.4)
        smoothed[i] = sum(vals) / len(vals)

    max_val = max(smoothed) or 1
    return [
        {
            "segment": i,
            "start": round(i * bucket_size, 1),
            "end": round((i + 1) * bucket_size, 1),
            "density": round(smoothed[i] / max_val, 3),
            "words": 0,
            "questions": final_samples[i],
        }
        for i in range(buckets)
    ]


@router.get("/semantic-tags")
def get_semantic_tags(youtube_id: str):
    """Generate semantic concept tags and learning type using Ollama.
    Returns immediately from DB cache if already generated."""
    import urllib.request as _ureq
    import re as _re

    # Check DB cache first
    conn = get_db()
    row = conn.execute(
        "SELECT semantic_tags_json, learning_type, transcript_json FROM videos WHERE youtube_id=?",
        (youtube_id,)
    ).fetchone()
    conn.close()

    if not row:
        return {"available": False, "reason": "video_not_found"}

    # Return cached result if available
    if row["semantic_tags_json"] and row["semantic_tags_json"] != "[]":
        try:
            tags = json.loads(row["semantic_tags_json"])
            if tags:
                return {"available": True, "tags": tags, "learning_type": row["learning_type"], "cached": True}
        except Exception:
            pass

    # Need transcript
    transcript = []
    if row["transcript_json"] and row["transcript_json"] != "[]":
        try:
            transcript = json.loads(row["transcript_json"])
        except Exception:
            pass
    if not transcript:
        transcript = fetch_transcript(youtube_id)
    if not transcript:
        return {"available": False, "reason": "no_transcript"}

    # Check Ollama
    try:
        req = _ureq.urlopen("http://localhost:11434/api/tags", timeout=2)
        tags_data = json.loads(req.read()); req.close()
        if not any("gemma3" in m.get("name","") for m in tags_data.get("models",[])):
            return {"available": False, "reason": "model_not_ready"}
    except Exception:
        return {"available": False, "reason": "ollama_not_running"}

    # Sample transcript — first 3000 chars is usually enough
    sample = " ".join(e["text"] for e in transcript)[:3000]

    prompt = (
        f"Analyze this video transcript and extract learning metadata.\n"
        f"Transcript sample:\n{sample}\n\n"
        f"Return ONLY this JSON, no other text:\n"
        f'{{"tags": ["tag1", "tag2", "tag3"], '
        f'"learning_type": "project_tutorial"}}\n\n'
        f"tags: 3-5 specific technical concepts (e.g. 'geometry nodes', 'procedural texture', "
        f"'physics simulation'). Use lowercase, 2-4 words each. Be specific, not generic.\n"
        f"learning_type: exactly one of: project_tutorial, concept_explainer, tips_tricks, "
        f"comparison, showcase"
    )

    payload = json.dumps({
        "model": "gemma3:4b",
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 120}
    }).encode()

    try:
        req = _ureq.Request("http://localhost:11434/api/generate",
            data=payload, headers={"Content-Type": "application/json"}, method="POST")
        with _ureq.urlopen(req, timeout=30) as resp:
            raw = json.loads(resp.read()).get("response", "").strip()
            m = _re.search(r'\{.*\}', raw, _re.DOTALL)
            if m:
                parsed = json.loads(m.group())
                tags = parsed.get("tags", [])[:5]
                learning_type = parsed.get("learning_type", "")

                # Validate learning_type
                valid_types = {"project_tutorial", "concept_explainer", "tips_tricks", "comparison", "showcase"}
                if learning_type not in valid_types:
                    learning_type = None

                # Save to DB
                conn = get_db()
                conn.execute(
                    "UPDATE videos SET semantic_tags_json=?, learning_type=? WHERE youtube_id=?",
                    (json.dumps(tags), learning_type, youtube_id)
                )
                conn.commit()
                conn.close()

                return {"available": True, "tags": tags, "learning_type": learning_type, "cached": False}
    except Exception as e:
        pass

    return {"available": False, "reason": "generation_failed"}


@router.get("/chapters")
def get_chapters(youtube_id: str):
    """Return chapters for a YouTube video. Checks DB first, falls back to yt-dlp."""
    conn = get_db()
    row = conn.execute(
        "SELECT chapters_json, duration_seconds FROM videos WHERE youtube_id = ?", (youtube_id,)
    ).fetchone()
    conn.close()

    if row and row["chapters_json"] and row["chapters_json"] != "[]":
        try:
            chapters = json.loads(row["chapters_json"])
            if chapters:
                return chapters
        except Exception:
            pass

    # Fall back to live fetch
    meta = fetch_video_metadata(youtube_id)
    return meta.get("chapters", [])


@router.get("/yt-tags")
def get_yt_tags(youtube_id: str):
    """Return tags for a video. Prefers semantic_tags_json (Ollama), falls back to live yt-dlp YouTube tags."""
    conn = get_db()
    row = conn.execute(
        "SELECT semantic_tags_json, tags_json FROM videos WHERE youtube_id = ?", (youtube_id,)
    ).fetchone()
    conn.close()

    # Prefer semantic tags (Ollama-generated, always meaningful)
    if row and row["semantic_tags_json"] and row["semantic_tags_json"] not in ("[]", "null", ""):
        try:
            tags = json.loads(row["semantic_tags_json"]) if isinstance(row["semantic_tags_json"], str) else row["semantic_tags_json"]
            if isinstance(tags, list) and tags:
                return {"tags": tags, "source": "semantic"}
        except Exception:
            pass

    # Live fetch via yt-dlp (YouTube's own creator tags — reliable)
    try:
        import yt_dlp
        ydl_opts = {"quiet": True, "no_warnings": True, "skip_download": True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(
                f"https://www.youtube.com/watch?v={youtube_id}", download=False
            )
            tags = info.get("tags") or []
            return {"tags": tags, "source": "live"}
    except Exception:
        return {"tags": [], "source": "error"}


@router.get("/summaries")
def get_chapter_summaries(youtube_id: str):
    """Generate per-chapter summaries + learning density scores using Ollama.
    Returns immediately with cached results if available, otherwise streams via polling.
    Each chapter gets: summary (2 sentences), score (0-10), key_concept (1 phrase).
    """
    import urllib.request
    import re

    # Get chapters
    chapters = []
    conn = get_db()
    row = conn.execute(
        "SELECT chapters_json, transcript_json, duration_seconds FROM videos WHERE youtube_id = ?",
        (youtube_id,)
    ).fetchone()
    conn.close()

    if row and row["chapters_json"] and row["chapters_json"] != "[]":
        try:
            chapters = json.loads(row["chapters_json"])
        except Exception:
            pass
    if not chapters:
        meta = fetch_video_metadata(youtube_id)
        chapters = meta.get("chapters", [])
    if not chapters:
        return {"available": False, "reason": "no_chapters", "summaries": []}

    # Get transcript
    transcript = []
    if row and row["transcript_json"]:
        try:
            transcript = json.loads(row["transcript_json"])
        except Exception:
            pass
    if not transcript:
        transcript = fetch_transcript(youtube_id)
    if not transcript:
        return {"available": False, "reason": "no_transcript", "summaries": []}

    total_duration = row["duration_seconds"] if row else 0

    # Check Ollama is available and model is loaded
    try:
        req = urllib.request.urlopen("http://localhost:11434/api/tags", timeout=2)
        tags_data = json.loads(req.read())
        req.close()
        model_names = [m.get("name", "") for m in tags_data.get("models", [])]
        if not any("gemma3" in n for n in model_names):
            return {"available": False, "reason": "model_not_ready",
                    "message": "gemma3:4b is still downloading. Try again in a moment.", "summaries": []}
    except Exception:
        return {"available": False, "reason": "ollama_not_running", "summaries": []}

    def get_chapter_transcript(ch_idx):
        ch = chapters[ch_idx]
        end = chapters[ch_idx + 1]["start_time"] if ch_idx + 1 < len(chapters) else total_duration
        lines = [e["text"] for e in transcript
                 if ch["start_time"] <= e.get("start", 0) < end]
        return " ".join(lines)[:2000]  # cap at ~2000 chars per chapter

    def ask_ollama(text, chapter_title, all_titles):
        chapters_context = ", ".join(f'"{t}"' for t in all_titles)
        prompt = (
            f'You are summarising a chapter from a tutorial video. '
            f'The full chapter list is: {chapters_context}.\n'
            f'Current chapter: "{chapter_title}"\n'
            f'Transcript:\n{text}\n\n'
            f'Write a 3-4 sentence summary that covers:\n'
            f'1. What specific concept or technique is introduced\n'
            f'2. What the viewer will be able to do after watching\n'
            f'3. Any key details, shortcuts, or gotchas mentioned\n\n'
            f'Do NOT just restate the chapter title. Be specific about what is actually shown.\n'
            f'Keep it under 80 words.\n\n'
            f'Reply with ONLY this JSON, no other text:\n'
            f'{{"summary": "your 3-4 sentence summary here", '
            f'"key_concept": "3 words max"}}'
        )
        payload = json.dumps({
            "model": "gemma3:4b",
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.3, "num_predict": 200}
        }).encode()
        req = urllib.request.Request(
            "http://localhost:11434/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            raw = result.get("response", "").strip()
            # Extract JSON from response
            match = re.search(r'\{.*\}', raw, re.DOTALL)
            if match:
                return json.loads(match.group())
        return None

    summaries = []
    for i, ch in enumerate(chapters):
        text = get_chapter_transcript(i)
        if not text.strip():
            summaries.append({
                "chapter_index": i,
                "title": ch["title"],
                "start_time": ch["start_time"],
                "summary": "",
                "key_concept": "",
                "score": 0,
            })
            continue
        try:
            all_titles = [c["title"] for c in chapters]
            result = ask_ollama(text, ch["title"], all_titles)
            summaries.append({
                "chapter_index": i,
                "title": ch["title"],
                "start_time": ch["start_time"],
                "summary": result.get("summary", "") if result else "",
                "key_concept": result.get("key_concept", "") if result else "",
                "score": 0,
            })
        except Exception as e:
            summaries.append({
                "chapter_index": i,
                "title": ch["title"],
                "start_time": ch["start_time"],
                "summary": "",
                "key_concept": "",
                "score": 5,
                "error": str(e),
            })

    return {"available": True, "summaries": summaries}


@router.get("/{video_id}")
def get_video(video_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Video not found")
    result = row_to_dict(row)
    return parse_json_fields(result, ["tags_json", "transcript_json"])


@router.patch("/{video_id}/position")
def save_position(video_id: int, position: float):
    """Save playback resume position for a library video."""
    conn = get_db()
    conn.execute("UPDATE videos SET last_position_seconds = ? WHERE id = ?", (position, video_id))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.patch("/{video_id}")
def update_video(video_id: int, body: VideoUpdate):
    conn = get_db()
    existing = conn.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "Video not found")
    if body.title is not None:
        conn.execute("UPDATE videos SET title = ? WHERE id = ?", (body.title, video_id))
    if body.tags_json is not None:
        conn.execute("UPDATE videos SET tags_json = ? WHERE id = ?", (json.dumps(body.tags_json), video_id))
    conn.commit()
    row = conn.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone()
    conn.close()
    result = row_to_dict(row)
    return parse_json_fields(result, ["tags_json", "transcript_json"])


@router.delete("/{video_id}", status_code=204)
def delete_video(video_id: int):
    conn = get_db()
    conn.execute("DELETE FROM videos WHERE id = ?", (video_id,))
    conn.commit()
    conn.close()


@router.get("/{video_id}/transcript")
def get_transcript(video_id: int):
    conn = get_db()
    row = conn.execute("SELECT transcript_json FROM videos WHERE id = ?", (video_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Video not found")
    try:
        return json.loads(row["transcript_json"])
    except Exception:
        return []


@router.post("/{video_id}/tags")
def add_tag(video_id: int, tag: str):
    conn = get_db()
    conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag,))
    tag_row = conn.execute("SELECT id FROM tags WHERE name = ?", (tag,)).fetchone()
    conn.execute(
        "INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)",
        (video_id, tag_row["id"]),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@router.delete("/{video_id}/tags/{tag_name}", status_code=204)
def remove_tag(video_id: int, tag_name: str):
    conn = get_db()
    tag_row = conn.execute("SELECT id FROM tags WHERE name = ?", (tag_name,)).fetchone()
    if tag_row:
        conn.execute(
            "DELETE FROM video_tags WHERE video_id = ? AND tag_id = ?",
            (video_id, tag_row["id"]),
        )
        conn.commit()
    conn.close()


class RefineClipBody(BaseModel):
    youtube_id: str
    start_seconds: float
    end_seconds: float


@router.post("/refine-clip")
def refine_clip(body: RefineClipBody):
    """Use Ollama to refine clip edges to the tightest self-contained idea."""
    import urllib.request
    import re as re_mod

    # Check Ollama available
    try:
        req = urllib.request.urlopen("http://localhost:11434/api/tags", timeout=2)
        tags_data = json.loads(req.read()); req.close()
        model_names = [m.get("name", "") for m in tags_data.get("models", [])]
        if not any("gemma3" in n for n in model_names):
            return {"start": body.start_seconds, "end": body.end_seconds,
                    "reason": "model not available", "refined": False}
    except Exception:
        return {"start": body.start_seconds, "end": body.end_seconds,
                "reason": "ollama not running", "refined": False}

    # Get transcript — DB first, then live fetch
    transcript = []
    conn = get_db()
    row = conn.execute("SELECT transcript_json FROM videos WHERE youtube_id = ?",
                       (body.youtube_id,)).fetchone()
    conn.close()
    if row and row["transcript_json"] and row["transcript_json"] != "[]":
        try:
            transcript = json.loads(row["transcript_json"])
        except Exception:
            pass
    if not transcript:
        transcript = fetch_transcript(body.youtube_id)
    if not transcript:
        return {"start": body.start_seconds, "end": body.end_seconds,
                "reason": "no transcript", "refined": False}

    # Extract entries in range with 15s buffer
    buf = 15.0
    entries = [e for e in transcript
               if body.start_seconds - buf <= e.get("start", 0) <= body.end_seconds + buf]
    if not entries:
        return {"start": body.start_seconds, "end": body.end_seconds,
                "reason": "no transcript in range", "refined": False}

    # Format for Ollama: include timestamps
    lines = "\n".join(f"[{e['start']:.1f}s] {e['text']}" for e in entries)

    prompt = (
        f"You are trimming a video clip. The clip currently spans {body.start_seconds:.1f}s to {body.end_seconds:.1f}s.\n"
        f"Here is the transcript around that range:\n{lines}\n\n"
        f"Find the tightest start and end timestamps that capture ONE complete, self-contained idea or explanation.\n"
        f"The result must be within the original range ({body.start_seconds:.1f}s to {body.end_seconds:.1f}s).\n"
        f"Reply with ONLY this JSON, no other text:\n"
        f'{{\"start\": {body.start_seconds:.1f}, \"end\": {body.end_seconds:.1f}, \"reason\": \"one sentence explanation\"}}'
    )

    payload = json.dumps({
        "model": "gemma3:4b",
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 100}
    }).encode()

    try:
        req = urllib.request.Request(
            "http://localhost:11434/api/generate",
            data=payload, headers={"Content-Type": "application/json"}, method="POST"
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            raw = result.get("response", "").strip()
            match = re_mod.search(r'\{.*\}', raw, re_mod.DOTALL)
            if match:
                parsed = json.loads(match.group())
                start = float(parsed.get("start", body.start_seconds))
                end = float(parsed.get("end", body.end_seconds))
                # Clamp to original range
                start = max(body.start_seconds - 2, min(start, body.end_seconds))
                end = min(body.end_seconds + 2, max(end, body.start_seconds))
                refined = abs(start - body.start_seconds) > 0.5 or abs(end - body.end_seconds) > 0.5
                return {"start": start, "end": end,
                        "reason": parsed.get("reason", ""), "refined": refined}
    except Exception as e:
        pass

    return {"start": body.start_seconds, "end": body.end_seconds,
            "reason": "refinement failed", "refined": False}

