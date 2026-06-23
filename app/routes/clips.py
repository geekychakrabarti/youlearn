from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.db import get_db, rows_to_list, row_to_dict

router = APIRouter(prefix="/api/clips", tags=["clips"])

VALID_TYPES = {"highlight", "question", "skip", "note", "extract"}


class ClipCreate(BaseModel):
    video_id: int
    timestamp_seconds: float
    end_seconds: Optional[float] = None
    label: Optional[str] = ""
    type: Optional[str] = "highlight"


class ClipUpdate(BaseModel):
    label: Optional[str] = None
    type: Optional[str] = None
    end_seconds: Optional[float] = None
    timestamp_seconds: Optional[float] = None
    ollama_refined: Optional[int] = None


@router.get("")
def list_clips(video_id: int):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM clips WHERE video_id = ? ORDER BY timestamp_seconds",
        (video_id,),
    ).fetchall()
    conn.close()
    return rows_to_list(rows)


@router.post("", status_code=201)
def create_clip(body: ClipCreate):
    if body.type not in VALID_TYPES:
        raise HTTPException(400, f"type must be one of {VALID_TYPES}")
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO clips (video_id, timestamp_seconds, end_seconds, label, type) VALUES (?, ?, ?, ?, ?)",
        (body.video_id, body.timestamp_seconds, body.end_seconds, body.label, body.type),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM clips WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return row_to_dict(row)


@router.patch("/{clip_id}")
def update_clip(clip_id: int, body: ClipUpdate):
    conn = get_db()
    existing = conn.execute("SELECT * FROM clips WHERE id = ?", (clip_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "Clip not found")
    if body.type and body.type not in VALID_TYPES:
        conn.close()
        raise HTTPException(400, f"type must be one of {VALID_TYPES}")
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(f"UPDATE clips SET {set_clause} WHERE id = ?", (*updates.values(), clip_id))
        conn.commit()
    row = conn.execute("SELECT * FROM clips WHERE id = ?", (clip_id,)).fetchone()
    conn.close()
    return row_to_dict(row)


@router.delete("/{clip_id}", status_code=204)
def delete_clip(clip_id: int):
    conn = get_db()
    conn.execute("DELETE FROM clips WHERE id = ?", (clip_id,))
    conn.commit()
    conn.close()
