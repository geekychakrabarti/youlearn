import json
import urllib.request
import urllib.parse
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.db import get_db, rows_to_list, row_to_dict
from app.config import load_config

router = APIRouter(prefix="/api/teachers", tags=["teachers"])


def _get_api_key() -> Optional[str]:
    return load_config().get("youtube_api_key")


def _yt_api(endpoint: str, params: dict) -> dict:
    key = _get_api_key()
    if not key:
        raise HTTPException(503, "YouTube API key not configured")
    params["key"] = key
    url = f"https://www.googleapis.com/youtube/v3/{endpoint}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise HTTPException(502, f"YouTube API error: {body[:200]}")
    except Exception as e:
        raise HTTPException(502, f"YouTube API request failed: {str(e)}")


# ── CRUD for trusted channels ──

@router.get("")
def list_teachers():
    conn = get_db()
    rows = conn.execute("SELECT * FROM trusted_channels ORDER BY name").fetchall()
    conn.close()
    return rows_to_list(rows)


class TeacherAdd(BaseModel):
    channel_id: str
    name: str
    thumbnail: Optional[str] = ""
    notes: Optional[str] = ""


@router.post("", status_code=201)
def add_teacher(body: TeacherAdd):
    conn = get_db()
    existing = conn.execute("SELECT id FROM trusted_channels WHERE channel_id=?", (body.channel_id,)).fetchone()
    if existing:
        conn.close()
        return row_to_dict(conn.execute("SELECT * FROM trusted_channels WHERE channel_id=?", (body.channel_id,)).fetchone() or existing)
    cur = conn.execute(
        "INSERT INTO trusted_channels (channel_id, name, thumbnail, notes) VALUES (?,?,?,?)",
        (body.channel_id, body.name, body.thumbnail or "", body.notes or "")
    )
    conn.commit()
    row = conn.execute("SELECT * FROM trusted_channels WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return row_to_dict(row)


@router.delete("/{teacher_id}", status_code=204)
def remove_teacher(teacher_id: int):
    conn = get_db()
    conn.execute("DELETE FROM trusted_channels WHERE id=?", (teacher_id,))
    conn.commit()
    conn.close()


# ── YouTube API search ──

@router.get("/lookup")
def lookup_channel(name: str):
    """Look up a YouTube channel ID by name using the Data API."""
    key = _get_api_key()
    if not key:
        raise HTTPException(503, "No API key")
    data = _yt_api("search", {"part": "snippet", "q": name, "type": "channel", "maxResults": 1})
    items = data.get("items", [])
    if not items:
        raise HTTPException(404, "Channel not found")
    item = items[0]
    return {
        "channel_id": item["snippet"]["channelId"],
        "name": item["snippet"]["title"],
        "thumbnail": item["snippet"]["thumbnails"].get("default", {}).get("url", ""),
    }


@router.get("/search")
def search_teachers(q: str, duration: Optional[str] = None, order: str = "relevance", limit: int = 12):
    """Search across all trusted channels using YouTube Data API v3."""
    conn = get_db()
    teachers = rows_to_list(conn.execute("SELECT * FROM trusted_channels").fetchall())
    conn.close()

    if not teachers:
        return {"results": [], "message": "No trusted teachers yet. Add some from Discover."}
    if not _get_api_key():
        return {"results": [], "message": "YouTube API key not configured"}

    # Map duration filter
    yt_duration = None
    if duration == "short":
        yt_duration = "short"       # <4 min
    elif duration == "medium":
        yt_duration = "medium"      # 4-20 min
    elif duration == "long":
        yt_duration = "long"        # >20 min

    all_results = []
    per_channel = max(3, limit // len(teachers))

    for teacher in teachers:
        params = {
            "part": "snippet",
            "channelId": teacher["channel_id"],
            "q": q,
            "type": "video",
            "maxResults": per_channel,
            "order": order,
        }
        if yt_duration:
            params["videoDuration"] = yt_duration

        try:
            data = _yt_api("search", params)
            video_ids = [i["id"]["videoId"] for i in data.get("items", [])]

            if video_ids:
                # Fetch view counts and durations
                stats = _yt_api("videos", {
                    "part": "statistics,contentDetails",
                    "id": ",".join(video_ids),
                })
                stats_map = {
                    v["id"]: v for v in stats.get("items", [])
                }

            for item in data.get("items", []):
                vid_id = item["id"]["videoId"]
                snippet = item["snippet"]
                stat = stats_map.get(vid_id, {}) if video_ids else {}
                view_count = int(stat.get("statistics", {}).get("viewCount", 0))

                # Parse ISO 8601 duration to seconds
                duration_seconds = _parse_duration(
                    stat.get("contentDetails", {}).get("duration", "PT0S")
                )

                all_results.append({
                    "youtube_id": vid_id,
                    "title": snippet["title"],
                    "channel": snippet["channelTitle"],
                    "channel_id": snippet["channelId"],
                    "thumbnail": snippet["thumbnails"].get("medium", {}).get("url", ""),
                    "url": f"https://www.youtube.com/watch?v={vid_id}",
                    "duration_seconds": duration_seconds,
                    "view_count": view_count,
                    "published_at": snippet.get("publishedAt", ""),
                })
        except Exception:
            continue  # skip failed channel, keep going

    # Sort by order
    if order == "viewCount":
        all_results.sort(key=lambda x: x["view_count"], reverse=True)

    return {"results": all_results[:limit], "teacher_count": len(teachers)}


def _parse_duration(iso: str) -> int:
    """Parse ISO 8601 duration (PT4M13S) to seconds."""
    import re
    match = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', iso)
    if not match:
        return 0
    h, m, s = (int(x or 0) for x in match.groups())
    return h * 3600 + m * 60 + s


@router.get("/has_key")
def has_api_key():
    return {"has_key": bool(_get_api_key())}
