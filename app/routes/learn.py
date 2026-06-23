import json
import urllib.request
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.db import get_db, rows_to_list

router = APIRouter(prefix="/api/learn", tags=["learn"])

OLLAMA_URL = "http://localhost:11434/api/generate"


class WhatsNextRequest(BaseModel):
    playlist_id: Optional[int] = None  # scope to playlist, or None for all


@router.post("/whats-next")
def whats_next(req: WhatsNextRequest):
    """Use Ollama to suggest next learning topics based on questions marked and videos watched."""
    conn = get_db()

    # Gather questions marked by the user
    sql_q = """
        SELECT n.body, v.title, v.semantic_tags_json
        FROM notes n
        JOIN videos v ON v.id = n.video_id
        WHERE n.is_question = 1
    """
    params = []
    if req.playlist_id:
        sql_q += " AND v.playlist_id = ?"
        params.append(req.playlist_id)
    questions = rows_to_list(conn.execute(sql_q, params).fetchall())

    # Gather semantic tags from watched videos
    sql_v = "SELECT title, semantic_tags_json, learning_type FROM videos WHERE semantic_tags_json IS NOT NULL AND semantic_tags_json != '[]'"
    if req.playlist_id:
        sql_v += " AND playlist_id = ?"
    videos = rows_to_list(conn.execute(sql_v, params).fetchall())
    conn.close()

    if not videos and not questions:
        raise HTTPException(400, "No learning data found. Add videos and mark questions first.")

    # Build context for Ollama
    topics = set()
    for v in videos:
        try:
            tags = json.loads(v["semantic_tags_json"]) if isinstance(v["semantic_tags_json"], str) else v["semantic_tags_json"]
            topics.update(tags[:3])
        except Exception:
            pass

    video_titles = [v["title"] for v in videos[:10]]
    question_texts = [q["body"] for q in questions[:10]]

    context_parts = []
    if video_titles:
        context_parts.append(f"Videos I've watched:\n" + "\n".join(f"- {t}" for t in video_titles))
    if topics:
        context_parts.append(f"Topics I've been learning: {', '.join(sorted(topics)[:15])}")
    if question_texts:
        context_parts.append(f"Questions I've marked while learning:\n" + "\n".join(f"- {q}" for q in question_texts))

    context = "\n\n".join(context_parts)

    prompt = f"""You are a learning advisor. Based on what someone has been learning, suggest 4 specific next topics to explore.

{context}

Respond with JSON only, no explanation:
{{
  "suggestions": [
    {{"topic": "short topic name", "reason": "one sentence why this is the right next step", "search": "youtube search query to find good videos on this"}},
    {{"topic": "...", "reason": "...", "search": "..."}},
    {{"topic": "...", "reason": "...", "search": "..."}},
    {{"topic": "...", "reason": "...", "search": "..."}}
  ]
}}"""

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
            timeout=30,
        )
        result = json.loads(r.read())
        raw = result.get("response", "")
        parsed = json.loads(raw) if raw else {}
        suggestions = parsed.get("suggestions", [])
        if not isinstance(suggestions, list):
            suggestions = []
        # Validate shape
        suggestions = [
            s for s in suggestions
            if isinstance(s, dict) and s.get("topic") and s.get("search")
        ][:4]
        return {"available": True, "suggestions": suggestions, "context_used": {
            "video_count": len(videos),
            "question_count": len(questions),
            "topic_count": len(topics),
        }}
    except Exception as e:
        return {"available": False, "error": str(e), "suggestions": []}
