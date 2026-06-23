import json
import re
import threading
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from app.db import get_db, row_to_dict
from app.config import get_video_folder, get_video_quality, resolve_video_path

router = APIRouter(prefix="/api/downloads", tags=["downloads"])

# In-memory download queue — one at a time
_queue: list[int] = []       # video IDs waiting
_active: Optional[int] = None # video ID currently downloading
_lock = threading.Lock()


def _safe_filename(channel: str, title: str, youtube_id: str) -> str:
    """Build a safe, meaningful filename."""
    def clean(s: str) -> str:
        s = s.strip()
        s = re.sub(r'[<>:"/\\|?*]', '', s)  # remove invalid chars
        s = re.sub(r'\s+', ' ', s)
        return s[:60].strip()

    parts = []
    if channel:
        parts.append(clean(channel))
    parts.append(clean(title) if title else youtube_id)
    parts.append(youtube_id)
    return " - ".join(parts) + ".mp4"


def _do_download(video_id: int):
    global _active
    conn = get_db()
    row = conn.execute(
        "SELECT youtube_id, title, channel FROM videos WHERE id = ?", (video_id,)
    ).fetchone()
    conn.close()
    if not row:
        _finish_download(video_id, None, "failed")
        return

    youtube_id = row["youtube_id"]
    filename = _safe_filename(row["channel"] or "", row["title"] or "", youtube_id)
    folder = get_video_folder()
    out_path = folder / filename
    quality = get_video_quality()

    # Mark as downloading
    _update_status(video_id, "downloading", None)

    try:
        import yt_dlp

        def progress_hook(d):
            if d["status"] == "downloading":
                pct = d.get("_percent_str", "").strip().rstrip("%")
                try:
                    p = int(float(pct))
                    _update_status(video_id, f"downloading:{p}", None)
                except Exception:
                    pass

        ydl_opts = {
            # Require H.264 (avc1) — Safari does not support AV1 or VP9
            "format": (
                f"bestvideo[height<={quality}][vcodec^=avc1]+bestaudio[ext=m4a]/"
                f"bestvideo[height<={quality}][vcodec^=avc]+bestaudio[ext=m4a]/"
                f"bestvideo[height<={quality}][ext=mp4][vcodec!*=av01][vcodec!*=vp9]+bestaudio[ext=m4a]/"
                f"best[height<={quality}][ext=mp4][vcodec!*=av01][vcodec!*=vp9]/"
                f"best[height<={quality}]"
            ),
            "merge_output_format": "mp4",
            "outtmpl": str(out_path),
            "quiet": True,
            "no_warnings": True,
            "progress_hooks": [progress_hook],
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([f"https://www.youtube.com/watch?v={youtube_id}"])

        if out_path.exists() and out_path.stat().st_size > 100_000:
            _finish_download(video_id, filename, "complete")
        else:
            _finish_download(video_id, None, "failed")

    except Exception as e:
        _finish_download(video_id, None, "failed")
    finally:
        _next_in_queue()


def _update_status(video_id: int, status: str, local_path: Optional[str]):
    conn = get_db()
    if local_path is not None:
        conn.execute(
            "UPDATE videos SET download_status=?, local_path=? WHERE id=?",
            (status, local_path, video_id)
        )
    else:
        conn.execute(
            "UPDATE videos SET download_status=? WHERE id=?",
            (status, video_id)
        )
    conn.commit()
    conn.close()


def _finish_download(video_id: int, filename: Optional[str], status: str):
    global _active
    _update_status(video_id, status, filename)
    with _lock:
        _active = None


def _next_in_queue():
    global _active, _queue
    with _lock:
        if _queue and _active is None:
            _active = _queue.pop(0)
            vid_id = _active
    if _active is not None:
        t = threading.Thread(target=_do_download, args=(vid_id,), daemon=True)
        t.start()


def enqueue_download(video_id: int):
    """Add a video to the download queue. Called automatically when a video is added."""
    global _queue, _active
    conn = get_db()
    row = conn.execute("SELECT download_status, local_path FROM videos WHERE id=?", (video_id,)).fetchone()
    conn.close()
    if not row:
        return
    status = row["download_status"] or "none"
    # Skip if already complete or actively downloading
    if status == "complete":
        # Verify file still exists
        if row["local_path"] and resolve_video_path(row["local_path"]):
            return  # file exists, no need to re-download
    if status.startswith("downloading"):
        return
    # Queue it
    with _lock:
        if video_id not in _queue and video_id != _active:
            _queue.append(video_id)
    _next_in_queue()


@router.post("/{video_id}/download")
def start_download(video_id: int):
    """Manually trigger or re-trigger a download."""
    conn = get_db()
    row = conn.execute("SELECT id FROM videos WHERE id=?", (video_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Video not found")
    # Force re-queue even if previously failed
    _update_status(video_id, "queued", None)
    with _lock:
        if video_id not in _queue and video_id != _active:
            _queue.insert(0, video_id)  # priority — user explicitly requested
    _next_in_queue()
    return {"ok": True, "status": "queued"}


@router.get("/status")
def get_download_status():
    """Return current download queue state."""
    global _queue, _active
    with _lock:
        return {"active": _active, "queue": list(_queue)}


@router.get("/file/{video_id}")
def serve_local_video(video_id: int, request: Request):
    """Serve local video file with byte-range support (required for Safari seeking)."""
    import re as _re
    conn = get_db()
    row = conn.execute("SELECT local_path FROM videos WHERE id=?", (video_id,)).fetchone()
    conn.close()
    if not row or not row["local_path"]:
        raise HTTPException(404, "No local file")
    path = resolve_video_path(row["local_path"])
    if not path:
        raise HTTPException(404, "File not found on disk")

    file_size = path.stat().st_size
    range_header = request.headers.get("range")

    if range_header:
        m = _re.match(r"bytes=(\d+)-(\d*)", range_header)
        if m:
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else file_size - 1
            end = min(end, file_size - 1)
            chunk = end - start + 1

            def _stream():
                with open(path, "rb") as f:
                    f.seek(start)
                    rem = chunk
                    while rem > 0:
                        data = f.read(min(65536, rem))
                        if not data:
                            break
                        rem -= len(data)
                        yield data

            return StreamingResponse(_stream(), status_code=206, headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk),
                "Content-Type": "video/mp4",
            })

    response = FileResponse(str(path), media_type="video/mp4")
    response.headers["Accept-Ranges"] = "bytes"
    response.headers["Content-Length"] = str(file_size)
    return response


@router.get("/config")
def get_config():
    from app.config import load_config
    cfg = load_config()
    folder = get_video_folder()
    return {
        "video_folder": str(folder),
        "folder_exists": folder.exists(),
        "video_quality": cfg["video_quality"],
    }
