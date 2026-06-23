import json
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from app.db import get_db, rows_to_list, row_to_dict, parse_json_fields
from app.transcript import format_timestamp

router = APIRouter(prefix="/api/export", tags=["export"])

EXPORTS_DIR = Path(__file__).parent.parent.parent / "exports"


def _get_playlist_data(playlist_id: int) -> dict:
    conn = get_db()
    playlist = conn.execute("SELECT * FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
    if not playlist:
        conn.close()
        raise HTTPException(404, "Playlist not found")
    videos = conn.execute(
        "SELECT * FROM videos WHERE playlist_id = ? ORDER BY added_at", (playlist_id,)
    ).fetchall()
    result = {"playlist": row_to_dict(playlist), "videos": []}
    for v in videos:
        vd = parse_json_fields(row_to_dict(v), ["tags_json"])
        vd.pop("transcript_json", None)
        clips = rows_to_list(conn.execute(
            "SELECT * FROM clips WHERE video_id = ? ORDER BY timestamp_seconds", (v["id"],)
        ).fetchall())
        notes = rows_to_list(conn.execute(
            "SELECT * FROM notes WHERE video_id = ? ORDER BY timestamp_seconds NULLS LAST", (v["id"],)
        ).fetchall())
        vd["clips"] = clips
        vd["notes"] = notes
        result["videos"].append(vd)
    conn.close()
    return result


def _to_study_sheet(data: dict) -> str:
    playlist = data["playlist"]
    lines = [f"# {playlist['name']}", ""]
    if playlist.get("description"):
        lines += [playlist["description"], ""]
    if playlist.get("topic"):
        lines += [f"**Topic:** {playlist['topic']}", ""]

    for v in data["videos"]:
        yt_url = f"https://www.youtube.com/watch?v={v['youtube_id']}"
        lines += [f"## [{v['title']}]({yt_url})", ""]

        # Chapters
        chapters = v.get("chapters_json") or []
        if isinstance(chapters, str):
            try:
                chapters = json.loads(chapters)
            except Exception:
                chapters = []
        if chapters:
            lines.append("### Chapters")
            for c in chapters:
                ts = format_timestamp(c["start_time"])
                ts_link = f"{yt_url}&t={int(c['start_time'])}"
                lines.append(f"- [{ts}]({ts_link}) {c['title']}")
            lines.append("")

        questions = [n for n in v.get("notes", []) if n["is_question"]]
        regular_notes = [n for n in v.get("notes", []) if not n["is_question"]]

        if questions:
            lines.append("### Questions")
            for n in questions:
                ts_part = ""
                if n.get("timestamp_seconds") is not None:
                    ts = format_timestamp(n["timestamp_seconds"])
                    ts_link = f"{yt_url}&t={int(n['timestamp_seconds'])}"
                    ts_part = f" [{ts}]({ts_link})"
                lines.append(f"- ❓{ts_part} {n['body']}")
            lines.append("")

        if regular_notes:
            lines.append("### Notes")
            for n in regular_notes:
                ts_part = ""
                if n.get("timestamp_seconds") is not None:
                    ts = format_timestamp(n["timestamp_seconds"])
                    ts_link = f"{yt_url}&t={int(n['timestamp_seconds'])}"
                    ts_part = f" [{ts}]({ts_link})"
                lines.append(f"- 📝{ts_part} {n['body']}")
            lines.append("")

    return "\n".join(lines)


@router.get("/playlist/{playlist_id}/markdown")
def export_markdown(playlist_id: int):
    data = _get_playlist_data(playlist_id)
    # Also fetch chapters_json for each video
    conn = get_db()
    for v in data["videos"]:
        row = conn.execute(
            "SELECT chapters_json FROM videos WHERE id = ?", (v["id"],)
        ).fetchone()
        if row:
            v["chapters_json"] = row["chapters_json"]
    conn.close()
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    slug = data["playlist"]["name"].lower().replace(" ", "-")
    filename = f"{slug}-study-sheet.md"
    path = EXPORTS_DIR / filename
    path.write_text(_to_study_sheet(data))
    return FileResponse(path, media_type="text/markdown", filename=filename)


@router.get("/playlist/{playlist_id}/json")
def export_json(playlist_id: int):
    data = _get_playlist_data(playlist_id)
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    slug = data["playlist"]["name"].lower().replace(" ", "-")
    filename = f"{slug}.json"
    path = EXPORTS_DIR / filename
    path.write_text(json.dumps(data, indent=2))
    return FileResponse(path, media_type="application/json", filename=filename)


@router.get("/tags")
def list_all_tags(search: Optional[str] = None):
    conn = get_db()
    if search:
        rows = conn.execute(
            "SELECT t.*, COUNT(vt.video_id) as video_count FROM tags t "
            "LEFT JOIN video_tags vt ON vt.tag_id = t.id "
            "WHERE t.name LIKE ? GROUP BY t.id ORDER BY video_count DESC",
            (f"%{search}%",),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT t.*, COUNT(vt.video_id) as video_count FROM tags t "
            "LEFT JOIN video_tags vt ON vt.tag_id = t.id "
            "GROUP BY t.id ORDER BY video_count DESC LIMIT 50"
        ).fetchall()
    conn.close()
    return rows_to_list(rows)
