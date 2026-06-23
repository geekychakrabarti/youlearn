from fastapi import FastAPI, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from pydantic import BaseModel
from typing import Optional

from app.db import init_db
from app.config import load_config, save_config
from app.routes import playlists, videos, clips, notes, export, search, downloads, teachers, learn

app = FastAPI(title="YouLearn", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()

# Queue downloads for any existing videos that haven't been downloaded yet
def _queue_existing_downloads():
    try:
        from app.db import get_db
        from app.routes.downloads import enqueue_download
        conn = get_db()
        rows = conn.execute(
            "SELECT id FROM videos WHERE download_status IS NULL OR download_status = 'none' OR download_status = 'failed'"
        ).fetchall()
        conn.close()
        for row in rows:
            enqueue_download(row["id"])
    except Exception:
        pass

import threading
threading.Thread(target=_queue_existing_downloads, daemon=True).start()

app.include_router(playlists.router)
app.include_router(videos.router)
app.include_router(clips.router)
app.include_router(notes.router)
app.include_router(export.router)
app.include_router(search.router)
app.include_router(downloads.router)
app.include_router(teachers.router)
app.include_router(learn.router)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/")
def serve_index():
    response = FileResponse(str(FRONTEND_DIR / "index.html"))
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/favicon.ico")
def serve_favicon_ico():
    return FileResponse(str(FRONTEND_DIR / "favicon-32.png"), media_type="image/png")


@app.get("/closing")
def serve_closing():
    """Page that closes the browser tab — navigated to by menubar on quit."""
    return HTMLResponse("""<!DOCTYPE html>
<html><head><title>YouLearn closing…</title></head>
<body>
<script>window.close(); setTimeout(() => { document.body.innerHTML = '<p style="font-family:sans-serif;color:#888;padding:40px">YouLearn has quit. You can close this tab.</p>'; }, 100);</script>
</body></html>""")


@app.get("/api/config")
def get_config():
    """Return current config (excluding API key)."""
    cfg = load_config()
    return {
        "video_folder": cfg.get("video_folder"),
        "db_path": cfg.get("db_path"),
        "video_quality": cfg.get("video_quality", "720"),
        "has_youtube_api_key": bool(cfg.get("youtube_api_key")),
    }


class StorageConfig(BaseModel):
    video_folder: Optional[str] = None
    db_path: Optional[str] = None


@app.post("/api/config/storage")
def set_storage(body: StorageConfig):
    """Update storage paths from the menu bar or settings UI."""
    updates = {}
    if body.video_folder:
        path = Path(body.video_folder)
        path.mkdir(parents=True, exist_ok=True)
        updates["video_folder"] = str(path)
    if body.db_path is not None:
        updates["db_path"] = body.db_path if body.db_path else None
    if updates:
        save_config(updates)
    return {"ok": True, "config": get_config()}


@app.middleware("http")
async def no_cache_static(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static/") and request.url.path.endswith((".js", ".css")):
        response.headers["Cache-Control"] = "no-store"
    return response
