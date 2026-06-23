from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.db import get_db, rows_to_list, row_to_dict

router = APIRouter(prefix="/api/playlists", tags=["playlists"])


class PlaylistCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    topic: Optional[str] = ""


class PlaylistUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    topic: Optional[str] = None


@router.get("")
def list_playlists():
    conn = get_db()
    rows = conn.execute(
        "SELECT p.*, COUNT(v.id) as video_count FROM playlists p "
        "LEFT JOIN videos v ON v.playlist_id = p.id "
        "GROUP BY p.id ORDER BY p.created_at DESC"
    ).fetchall()
    conn.close()
    return rows_to_list(rows)


@router.post("", status_code=201)
def create_playlist(body: PlaylistCreate):
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO playlists (name, description, topic) VALUES (?, ?, ?)",
        (body.name, body.description, body.topic),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM playlists WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return row_to_dict(row)


@router.get("/{playlist_id}")
def get_playlist(playlist_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Playlist not found")
    return row_to_dict(row)


@router.patch("/{playlist_id}")
def update_playlist(playlist_id: int, body: PlaylistUpdate):
    conn = get_db()
    existing = conn.execute("SELECT * FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "Playlist not found")
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(
            f"UPDATE playlists SET {set_clause} WHERE id = ?",
            (*updates.values(), playlist_id),
        )
        conn.commit()
    row = conn.execute("SELECT * FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
    conn.close()
    return row_to_dict(row)


@router.delete("/{playlist_id}", status_code=204)
def delete_playlist(playlist_id: int):
    conn = get_db()
    conn.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
    conn.commit()
    conn.close()


@router.patch("/{playlist_id}/last-video")
def set_last_active_video(playlist_id: int, video_id: int):
    """Remember which video was last active in this playlist."""
    conn = get_db()
    conn.execute("UPDATE playlists SET last_active_video_id = ? WHERE id = ?", (video_id, playlist_id))
    conn.commit()
    conn.close()
    return {"ok": True}

