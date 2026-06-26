import json
import re
import threading
import urllib.request
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from app.db import get_db, rows_to_list

router = APIRouter(prefix="/api/segments", tags=["segments"])


class GenerateSegmentsBody(BaseModel):
    video_id: int
    youtube_id: str
    force: Optional[bool] = False


@router.get("")
def get_segments(youtube_id: str):
    """Return cached segments for a video. If none exist, trigger background generation."""
    conn = get_db()
    row = conn.execute("SELECT id FROM videos WHERE youtube_id = ?", (youtube_id,)).fetchone()
    if not row:
        conn.close()
        return {"segments": [], "generating": False}

    video_id = row["id"]
    segs = conn.execute(
        "SELECT * FROM video_segments WHERE video_id = ? ORDER BY start_seconds",
        (video_id,)
    ).fetchall()
    conn.close()

    if segs:
        return {"segments": rows_to_list(segs), "generating": False}

    # No segments yet — trigger background generation
    threading.Thread(target=_generate_segments_bg, args=(video_id, youtube_id), daemon=True).start()
    return {"segments": [], "generating": True}


@router.post("/generate")
def generate_segments(body: GenerateSegmentsBody):
    """Force (re-)generate segments for a video. Deletes existing if force=True."""
    conn = get_db()
    if body.force:
        conn.execute("DELETE FROM video_segments WHERE video_id = ?", (body.video_id,))
        conn.commit()
    conn.close()
    threading.Thread(target=_generate_segments_bg, args=(body.video_id, body.youtube_id), daemon=True).start()
    return {"ok": True, "generating": True}


def _generate_segments_bg(video_id: int, youtube_id: str):
    """Background: segment video by semantic concepts using Ollama gemma3:12b."""
    try:
        conn = get_db()

        # Skip if segments already exist (another thread may have run first)
        count = conn.execute(
            "SELECT COUNT(*) FROM video_segments WHERE video_id = ?", (video_id,)
        ).fetchone()[0]
        if count > 0:
            conn.close()
            return

        # Get transcript — DB first, live fallback (same pattern as refine-clip)
        row = conn.execute(
            "SELECT transcript_json FROM videos WHERE id = ?", (video_id,)
        ).fetchone()
        conn.close()

        transcript = []
        if row and row["transcript_json"] and row["transcript_json"] != "[]":
            try:
                transcript = json.loads(row["transcript_json"])
            except Exception:
                pass
        if not transcript:
            from app.transcript import fetch_transcript
            transcript = fetch_transcript(youtube_id)
        if not transcript:
            return

        # Check Ollama available with gemma3:12b
        try:
            req = urllib.request.urlopen("http://localhost:11434/api/tags", timeout=2)
            tags_data = json.loads(req.read())
            req.close()
            model_names = [m.get("name", "") for m in tags_data.get("models", [])]
            if not any("gemma3" in n for n in model_names):
                return
        except Exception:
            return

        # Build full timestamped transcript
        lines = "\n".join(f"[{e.get('start', 0):.1f}s] {e.get('text', '').strip()}" for e in transcript)

        prompt = (
            "You are analysing a video tutorial transcript to identify its major teaching phases.\n"
            "Divide the video into 5-10 segments where each segment covers one coherent concept, step, or idea.\n"
            "Segments must be contiguous and together cover the full video from start to finish.\n\n"
            "Note: transcript may have no punctuation (auto-generated captions).\n\n"
            "For each segment return:\n"
            "- start: timestamp in seconds where this segment begins\n"
            "- end: timestamp in seconds where this segment ends\n"
            "- label: short concept name (3-6 words, e.g. 'Adding materials to mesh')\n\n"
            "Return ONLY valid JSON, no other text:\n"
            '{"segments": [{"start": 0, "end": 45.2, "label": "Introduction and overview"}, ...]}\n\n'
            f"Transcript:\n{lines}"
        )

        payload = json.dumps({
            "model": "gemma3:12b",
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.1, "num_predict": 600},
        }).encode()

        req = urllib.request.Request(
            "http://localhost:11434/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = json.loads(resp.read()).get("response", "").strip()

        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if not match:
            return

        parsed = json.loads(match.group())
        segments = parsed.get("segments", [])
        if not segments:
            return

        # Insert segments
        conn = get_db()
        for seg in segments:
            start = seg.get("start")
            end = seg.get("end")
            label = seg.get("label", "").strip()
            if start is None or end is None or not label:
                continue
            conn.execute(
                "INSERT INTO video_segments (video_id, start_seconds, end_seconds, concept_label) VALUES (?, ?, ?, ?)",
                (video_id, float(start), float(end), label),
            )
        conn.commit()
        conn.close()

    except Exception:
        pass
