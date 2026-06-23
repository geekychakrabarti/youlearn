from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.db import get_db, rows_to_list, row_to_dict

router = APIRouter(prefix="/api/notes", tags=["notes"])


class NoteCreate(BaseModel):
    video_id: int
    timestamp_seconds: Optional[float] = None
    body: str
    is_question: Optional[bool] = False


class NoteUpdate(BaseModel):
    body: Optional[str] = None
    is_question: Optional[bool] = None
    timestamp_seconds: Optional[float] = None


@router.get("")
def list_notes(video_id: int, questions_only: bool = False):
    conn = get_db()
    query = "SELECT * FROM notes WHERE video_id = ?"
    params = [video_id]
    if questions_only:
        query += " AND is_question = 1"
    query += " ORDER BY timestamp_seconds NULLS LAST, created_at"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return rows_to_list(rows)


@router.post("", status_code=201)
def create_note(body: NoteCreate):
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO notes (video_id, timestamp_seconds, body, is_question) VALUES (?, ?, ?, ?)",
        (body.video_id, body.timestamp_seconds, body.body, int(body.is_question)),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return row_to_dict(row)


@router.patch("/{note_id}")
def update_note(note_id: int, body: NoteUpdate):
    conn = get_db()
    existing = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "Note not found")
    updates = {}
    if body.body is not None:
        updates["body"] = body.body
    if body.is_question is not None:
        updates["is_question"] = int(body.is_question)
    if body.timestamp_seconds is not None:
        updates["timestamp_seconds"] = body.timestamp_seconds
    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(f"UPDATE notes SET {set_clause} WHERE id = ?", (*updates.values(), note_id))
        conn.commit()
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    conn.close()
    return row_to_dict(row)


@router.delete("/{note_id}", status_code=204)
def delete_note(note_id: int):
    conn = get_db()
    conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    conn.commit()
    conn.close()
