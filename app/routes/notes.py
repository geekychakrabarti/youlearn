import json
import re
import urllib.request
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
    source: Optional[str] = "user"


class NoteUpdate(BaseModel):
    body: Optional[str] = None
    is_question: Optional[bool] = None
    timestamp_seconds: Optional[float] = None


class DetectQuestionsBody(BaseModel):
    video_id: int
    youtube_id: str
    force: Optional[bool] = False  # True = delete cached and re-run


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
        "INSERT INTO notes (video_id, timestamp_seconds, body, is_question, source) VALUES (?, ?, ?, ?, ?)",
        (body.video_id, body.timestamp_seconds, body.body, int(body.is_question), body.source or "user"),
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


@router.post("/detect-questions")
def detect_questions(body: DetectQuestionsBody):
    conn = get_db()

    # Return cached results unless force=True
    if not body.force:
        cached = conn.execute(
            "SELECT * FROM notes WHERE video_id = ? AND source = 'ollama' ORDER BY timestamp_seconds",
            (body.video_id,)
        ).fetchall()
        if cached:
            conn.close()
            return {"questions": rows_to_list(cached), "count": len(cached), "cached": True}

    # Delete stale ollama questions when re-running
    if body.force:
        conn.execute("DELETE FROM notes WHERE video_id = ? AND source = 'ollama'", (body.video_id,))
        conn.commit()

    # Check Ollama available
    try:
        req = urllib.request.urlopen("http://localhost:11434/api/tags", timeout=2)
        tags_data = json.loads(req.read())
        req.close()
        model_names = [m.get("name", "") for m in tags_data.get("models", [])]
        if not any("gemma3" in n for n in model_names):
            conn.close()
            return {"questions": [], "count": 0, "error": "gemma3 model not available"}
    except Exception:
        conn.close()
        return {"questions": [], "count": 0, "error": "ollama not running"}

    # Fetch transcript
    row = conn.execute(
        "SELECT transcript_json FROM videos WHERE youtube_id = ?", (body.youtube_id,)
    ).fetchone()
    if not row or not row["transcript_json"] or row["transcript_json"] == "[]":
        conn.close()
        return {"questions": [], "count": 0, "error": "no transcript"}

    try:
        transcript = json.loads(row["transcript_json"])
    except Exception:
        conn.close()
        return {"questions": [], "count": 0, "error": "transcript parse error"}

    # Build timestamped transcript string — only entries containing '?'
    # so Ollama has no non-question material to confuse with questions
    question_lines = []
    all_lines = []
    chars = 0
    for e in transcript:
        text = e.get('text', '').strip()
        line = f"[{e.get('start', 0):.1f}s] {text}"
        if chars + len(line) > 4000:
            break
        all_lines.append(line)
        chars += len(line)
        if '?' in text:
            question_lines.append(line)

    # If no '?' in transcript at all, skip Ollama — nothing to find
    if not question_lines:
        conn.close()
        return {"questions": [], "count": 0, "reason": "no questions found in transcript"}

    # Use only question-containing lines — prevents Ollama inventing questions from statements
    transcript_text = "\n".join(question_lines)

    prompt = (
        "You are analysing a video transcript. Your task is to find ONLY genuine questions — "
        "sentences that end with a question mark and directly ask something of the viewer or invite reflection.\n\n"
        "Rules:\n"
        "- Include ONLY interrogative sentences that end with '?'\n"
        "- Do NOT include statements, tips, steps, descriptions, or sentences that do not end with '?'\n"
        "- Do NOT rephrase statements as questions\n"
        "- If there are fewer than 3 real questions in the transcript, return fewer — do not invent any\n"
        "- Maximum 8 questions\n\n"
        "For each question found, return the timestamp in seconds (from the [Xs] markers) where it appears "
        "and the exact question text from the transcript.\n"
        "Reply ONLY with valid JSON, no other text:\n"
        '{"questions": [{"timestamp": 12.3, "question": "What is X?"}, ...]}\n\n'
        f"Transcript:\n{transcript_text}"
    )

    payload = json.dumps({
        "model": "gemma3:4b",
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 400},
    }).encode()

    try:
        req = urllib.request.Request(
            "http://localhost:11434/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = json.loads(resp.read()).get("response", "").strip()
    except Exception as e:
        conn.close()
        return {"questions": [], "count": 0, "error": f"ollama call failed: {e}"}

    # Extract JSON from response
    match = re.search(r'\{.*\}', raw, re.DOTALL)
    if not match:
        conn.close()
        return {"questions": [], "count": 0, "error": "could not parse ollama response"}

    try:
        parsed = json.loads(match.group())
        items = parsed.get("questions", [])
    except Exception:
        conn.close()
        return {"questions": [], "count": 0, "error": "invalid json from ollama"}

    # Insert into notes table
    inserted = []
    for item in items:
        ts = item.get("timestamp")
        q = item.get("question", "").strip()
        if not q:
            continue
        cur = conn.execute(
            "INSERT INTO notes (video_id, timestamp_seconds, body, is_question, source) VALUES (?, ?, ?, 1, 'ollama')",
            (body.video_id, ts, q),
        )
        note_row = conn.execute("SELECT * FROM notes WHERE id = ?", (cur.lastrowid,)).fetchone()
        inserted.append(row_to_dict(note_row))

    conn.commit()
    conn.close()
    return {"questions": inserted, "count": len(inserted), "cached": False}
