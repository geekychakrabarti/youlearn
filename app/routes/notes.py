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

    # Build timestamped transcript string (up to 4000 chars)
    lines = []
    chars = 0
    for e in transcript:
        text = e.get('text', '').strip()
        if not text:
            continue
        line = f"[{e.get('start', 0):.1f}s] {text}"
        if chars + len(line) > 4000:
            break
        lines.append(line)
        chars += len(line)
    transcript_text = "\n".join(lines)

    if not transcript_text:
        conn.close()
        return {"questions": [], "count": 0, "reason": "no transcript text"}

    prompt = (
        "You are analysing a video transcript. Note: this transcript may have no punctuation "
        "because it was auto-generated.\n\n"
        "Your task: find sentences where the presenter ASKS something — rhetorical questions, "
        "invitations to think, 'what if', 'have you ever', 'why does', 'how do you' constructions, "
        "or direct questions to the viewer. These are questions by MEANING even without a '?'.\n\n"
        "Strict rules:\n"
        "- Only include genuine questions — things the presenter is asking, not stating or instructing\n"
        "- Do NOT include statements, tips, steps, or instructions (e.g. 'start by describing your product' is NOT a question)\n"
        "- Do NOT rephrase statements as questions\n"
        "- If there are no genuine questions at all, return an empty array\n"
        "- Maximum 8 questions\n\n"
        "For each question, return the timestamp (from the [Xs] markers) and the question text.\n"
        "Reply ONLY with valid JSON:\n"
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

    # Insert into notes table — filter out obvious non-questions (too short, no verb)
    inserted = []
    for item in items:
        ts = item.get("timestamp")
        q = item.get("question", "").strip()
        # Discard if too short (likely a fragment) or doesn't contain a question word or verb
        if not q or len(q.split()) < 5:
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
