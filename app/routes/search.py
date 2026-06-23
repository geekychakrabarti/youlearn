import json
import urllib.request
import urllib.parse
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.db import get_db, rows_to_list
from app.config import load_config

router = APIRouter(prefix="/api/search", tags=["search"])


def _yt_api_search(q: str, channel_id: Optional[str], order: str,
                   duration: Optional[str], dur_min: Optional[int],
                   dur_max: Optional[int], limit: int, key: str,
                   page_token: Optional[str] = None,
                   category_id: Optional[str] = None) -> dict:
    """Search using YouTube Data API v3. Returns {videos, next_page_token}."""
    import re as _re

    params = {
        "part": "snippet",
        "q": q if q.strip() else "",
        "type": "video",
        "maxResults": min(limit, 50),
        "order": order,
        "key": key,
    }
    if channel_id:
        params["channelId"] = channel_id
    if page_token:
        params["pageToken"] = page_token
    if category_id:
        params["videoCategoryId"] = category_id
    # Native duration filter
    if duration == "short":
        params["videoDuration"] = "short"
    elif duration == "medium":
        params["videoDuration"] = "medium"
    elif duration == "long":
        params["videoDuration"] = "long"

    url = f"https://www.googleapis.com/youtube/v3/search?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=10) as r:
        data = json.loads(r.read())

    next_page_token = data.get("nextPageToken")
    items = data.get("items", [])
    if not items:
        return {"videos": [], "next_page_token": None}

    # Fetch video stats for view counts + exact duration
    video_ids = [i["id"]["videoId"] for i in items if i.get("id", {}).get("videoId")]
    stats_map = {}
    if video_ids:
        stats_url = (
            f"https://www.googleapis.com/youtube/v3/videos"
            f"?part=statistics,contentDetails&id={','.join(video_ids)}&key={key}"
        )
        with urllib.request.urlopen(stats_url, timeout=10) as r:
            stats_data = json.loads(r.read())
        for v in stats_data.get("items", []):
            stats_map[v["id"]] = v

    results = []
    for item in items:
        vid_id = item.get("id", {}).get("videoId", "")
        if not vid_id:
            continue
        snippet = item["snippet"]
        stat = stats_map.get(vid_id, {})
        view_count = int(stat.get("statistics", {}).get("viewCount", 0))
        duration_seconds = _parse_iso_duration(
            stat.get("contentDetails", {}).get("duration", "PT0S")
        )

        # Apply custom duration filter post-fetch (API doesn't support exact ranges)
        if duration == "custom":
            if dur_min is not None and duration_seconds < dur_min * 60:
                continue
            if dur_max is not None and duration_seconds > dur_max * 60:
                continue

        thumbs = snippet.get("thumbnails", {})
        thumb = (thumbs.get("medium") or thumbs.get("default") or {}).get("url", "")

        results.append({
            "youtube_id": vid_id,
            "title": snippet["title"],
            "channel": snippet["channelTitle"],
            "channel_id": snippet["channelId"],
            "thumbnail": thumb or f"https://img.youtube.com/vi/{vid_id}/mqdefault.jpg",
            "url": f"https://www.youtube.com/watch?v={vid_id}",
            "duration_seconds": duration_seconds,
            "view_count": view_count,
            "published_at": snippet.get("publishedAt", ""),
        })

    return {"videos": results, "next_page_token": next_page_token}

    return results


def _parse_iso_duration(iso: str) -> int:
    import re
    m = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', iso)
    if not m:
        return 0
    h, mn, s = (int(x or 0) for x in m.groups())
    return h * 3600 + mn * 60 + s


def _ytdlp_search(q: str, channel: Optional[str], duration: Optional[str],
                  dur_min: Optional[int], dur_max: Optional[int], limit: int) -> list:
    """Fallback search via yt-dlp (no API key, no view counts, no native sort)."""
    import yt_dlp
    effective_query = q.strip()
    if channel:
        effective_query = f"{effective_query} {channel.strip()}"
    ydl_opts = {"quiet": True, "no_warnings": True, "skip_download": True, "extract_flat": True}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        results = ydl.extract_info(f"ytsearch{limit}:{effective_query}", download=False)
        entries = results.get("entries", []) or []

    videos = []
    for e in entries:
        if not e:
            continue
        dur = e.get("duration") or 0
        ch = e.get("channel") or e.get("uploader") or ""
        videos.append({
            "youtube_id": e.get("id", ""),
            "title": e.get("title", ""),
            "duration_seconds": dur,
            "thumbnail": e.get("thumbnail") or f"https://img.youtube.com/vi/{e.get('id','')}/mqdefault.jpg",
            "channel": ch,
            "channel_id": e.get("channel_id") or "",
            "url": f"https://www.youtube.com/watch?v={e.get('id','')}",
            "view_count": 0,
        })

    # Post-fetch duration filter
    if duration == "short":
        videos = [v for v in videos if v["duration_seconds"] < 600]
    elif duration == "medium":
        videos = [v for v in videos if 600 <= v["duration_seconds"] <= 1800]
    elif duration == "long":
        videos = [v for v in videos if v["duration_seconds"] > 1800]
    elif duration == "custom":
        if dur_min is not None:
            videos = [v for v in videos if v["duration_seconds"] >= dur_min * 60]
        if dur_max is not None:
            videos = [v for v in videos if v["duration_seconds"] <= dur_max * 60]

    # Prefer exact channel matches
    if channel:
        ch_lower = channel.strip().lower()
        exact = [v for v in videos if ch_lower in v["channel"].lower()]
        rest  = [v for v in videos if ch_lower not in v["channel"].lower()]
        videos = exact + rest

    return videos


def _parse_operators(raw_q: str) -> dict:
    """Extract operators from query string. Returns {clean_q, order, channel, duration}."""
    import re
    q = raw_q.strip()
    result = {"order": None, "channel": None, "duration": None}

    # from:channel or from:"channel name"
    m = re.search(r'\bfrom:(["\']?)([^"\':\s]+(?:\s+[^"\':\s]+)*)\1', q, re.I)
    if m:
        result["channel"] = m.group(2).strip()
        q = re.sub(r'\bfrom:["\']?[^"\':\s]+(?:\s+[^"\':\s]+)*["\']?', '', q, flags=re.I).strip()

    # order:views / order:recent / order:relevance
    m = re.search(r'\border:(views?|recent|relevance)\b', q, re.I)
    if m:
        val = m.group(1).lower()
        result["order"] = "viewCount" if val.startswith("view") else ("date" if val == "recent" else "relevance")
        q = re.sub(r'\border:\w+', '', q, flags=re.I).strip()

    # duration:short / duration:medium / duration:long
    m = re.search(r'\bduration:(short|medium|long)\b', q, re.I)
    if m:
        result["duration"] = m.group(1).lower()
        q = re.sub(r'\bduration:\w+', '', q, flags=re.I).strip()

    # category:education → videoCategoryId=27
    m = re.search(r'\bcategory:(\w+)\b', q, re.I)
    if m:
        result["category_id"] = "27" if m.group(1).lower() == "education" else None
        q = re.sub(r'\bcategory:\w+', '', q, flags=re.I).strip()

    result["clean_q"] = re.sub(r'\s+', ' ', q).strip()
    return result


@router.get("/youtube")
def search_youtube(q: str, duration: Optional[str] = None, channel: Optional[str] = None,
                   channel_id: Optional[str] = None, order: str = "relevance",
                   dur_min: Optional[int] = None, dur_max: Optional[int] = None,
                   teachers_only: bool = False, limit: int = 50,
                   page_token: Optional[str] = None):
    """Search YouTube. Parses operators from q, uses Data API v3 if key configured."""
    if not q or not q.strip():
        raise HTTPException(400, "Query required")

    # Parse operators out of the query
    ops = _parse_operators(q)
    clean_q = ops["clean_q"] or q
    if ops["order"] and order == "relevance":
        order = ops["order"]
    if ops["channel"] and not channel:
        channel = ops["channel"]
    if ops["duration"] and not duration:
        duration = ops["duration"]

    # When channel_id is provided, ignore the query and return all videos from
    # that channel. YouTube's channelId + text search often returns unrelated
    # results from other channels; an empty query returns the channel's own videos.
    if channel_id:
        clean_q = ""

    # When only channel name with no channel_id and no other query, use name as query
    elif channel and not channel_id and not clean_q.strip():
        clean_q = channel

    key = load_config().get("youtube_api_key")
    api_available = False
    videos = []
    next_page_token = None

    # Try YouTube Data API first
    if key:
        try:
            if teachers_only:
                conn = get_db()
                teachers = rows_to_list(conn.execute("SELECT * FROM trusted_channels").fetchall())
                conn.close()
                per_channel = max(3, limit // len(teachers)) if teachers else limit
                for t in teachers:
                    try:
                        result = _yt_api_search(
                            clean_q, t["channel_id"], order, duration, dur_min, dur_max, per_channel, key
                        )
                        videos.extend(result["videos"])
                    except Exception:
                        continue
                if order == "viewCount":
                    videos.sort(key=lambda x: x.get("view_count", 0), reverse=True)
            else:
                result = _yt_api_search(
                    clean_q, channel_id or None, order, duration, dur_min, dur_max, limit, key,
                    page_token, ops.get("category_id")
                )
                videos = result["videos"]
                next_page_token = result["next_page_token"]
                # Channel name filter post-fetch when no channel_id
                if channel and not channel_id:
                    ch_lower = channel.strip().lower()
                    exact = [v for v in videos if ch_lower in v["channel"].lower()]
                    rest  = [v for v in videos if ch_lower not in v["channel"].lower()]
                    videos = exact + rest

            api_available = True
        except Exception:
            videos = []

    # yt-dlp fallback
    if not videos and not teachers_only:
        try:
            videos = _ytdlp_search(clean_q, channel, duration, dur_min, dur_max, limit)
        except Exception as e:
            raise HTTPException(500, f"Search failed: {str(e)}")

    return {
        "videos": videos[:limit],
        "api_available": api_available,
        "total": len(videos),
        "next_page_token": next_page_token,
        "operators_applied": {k: v for k, v in ops.items() if v and k != "clean_q"},
        "clean_q": ops.get("clean_q", q),
        "channel_scoped": bool(channel_id or channel),
    }




@router.get("/transcript")
def search_transcript(q: str, playlist_id: Optional[int] = None, limit: int = 30):
    """Search across stored transcripts. Returns timestamped matches with snippets."""
    if not q or not q.strip():
        raise HTTPException(400, "Query required")

    query_lower = q.strip().lower()
    conn = get_db()

    sql = "SELECT id, youtube_id, title, transcript_json FROM videos WHERE transcript_json != '[]'"
    params = []
    if playlist_id:
        sql += " AND playlist_id = ?"
        params.append(playlist_id)

    rows = conn.execute(sql, params).fetchall()
    conn.close()

    results = []
    for row in rows:
        try:
            transcript = json.loads(row["transcript_json"])
        except Exception:
            continue

        matches_for_video = 0
        for i, entry in enumerate(transcript):
            text = entry.get("text", "")
            if query_lower not in text.lower():
                continue

            # Build a snippet: the matching entry + one before and after for context
            before = transcript[i - 1]["text"] if i > 0 else ""
            after = transcript[i + 1]["text"] if i < len(transcript) - 1 else ""
            snippet = " … ".join(filter(None, [before, text, after])).strip()

            # Highlight the match within the snippet (wrap in marker tags)
            idx = snippet.lower().find(query_lower)
            if idx >= 0:
                snippet = (
                    snippet[:idx]
                    + "<mark>"
                    + snippet[idx: idx + len(q)]
                    + "</mark>"
                    + snippet[idx + len(q):]
                )

            results.append({
                "video_id": row["id"],
                "youtube_id": row["youtube_id"],
                "title": row["title"],
                "timestamp_seconds": entry.get("start", 0),
                "snippet": snippet,
            })

            matches_for_video += 1
            if matches_for_video >= 3:  # max 3 matches per video
                break

        if len(results) >= limit:
            break

    return results


class SimilarRequest(BaseModel):
    youtube_id: str
    transcript_sample: str = ""


@router.post("/similar")
def find_similar(req: SimilarRequest):
    """Use Ollama to extract search keywords from a transcript, for finding related videos."""
    OLLAMA_URL = "http://localhost:11434/api/generate"

    if not req.transcript_sample.strip():
        return {"available": False, "query": ""}

    prompt = (
        "Given this video transcript excerpt, generate 4-5 short search keywords or phrases "
        "that would find related YouTube videos on the same topic. "
        "Return JSON only, no explanation: {\"keywords\": [\"...\", \"...\"]}\n\n"
        f"Transcript:\n{req.transcript_sample[:2000]}"
    )

    try:
        payload = json.dumps({
            "model": "gemma3:4b",
            "prompt": prompt,
            "stream": False,
            "format": "json",
        }).encode()
        r = urllib.request.urlopen(
            urllib.request.Request(OLLAMA_URL, data=payload,
                                   headers={"Content-Type": "application/json"}),
            timeout=20,
        )
        result = json.loads(r.read())
        raw = result.get("response", "")
        parsed = json.loads(raw) if raw else {}
        keywords = parsed.get("keywords", [])
        if not isinstance(keywords, list):
            keywords = []
        query = " ".join(str(k) for k in keywords[:5] if k)
        return {"available": True, "query": query or req.transcript_sample[:60]}
    except Exception:
        return {"available": False, "query": ""}
