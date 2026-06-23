import re
import json
from collections import Counter
from typing import Optional

from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled


def extract_youtube_id(url: str) -> Optional[str]:
    patterns = [
        r"(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def fetch_video_metadata(youtube_id: str) -> dict:
    """Fetch title, duration, thumbnail, channel, chapters via yt-dlp."""
    try:
        import yt_dlp
        ydl_opts = {"quiet": True, "no_warnings": True, "skip_download": True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(
                f"https://www.youtube.com/watch?v={youtube_id}", download=False
            )
            chapters = [
                {"title": c.get("title", ""), "start_time": c.get("start_time", 0), "end_time": c.get("end_time", 0)}
                for c in (info.get("chapters") or [])
            ]
            return {
                "title": info.get("title", ""),
                "duration_seconds": info.get("duration", 0),
                "thumbnail": info.get("thumbnail", ""),
                "channel": info.get("uploader", ""),
                "chapters": chapters,
            }
    except Exception as e:
        return {
            "title": "",
            "duration_seconds": 0,
            "thumbnail": f"https://img.youtube.com/vi/{youtube_id}/mqdefault.jpg",
            "channel": "",
            "chapters": [],
            "error": str(e),
        }


def fetch_transcript(youtube_id: str) -> list:
    """Returns list of {text, start, duration} dicts."""
    api = YouTubeTranscriptApi()
    try:
        transcript = api.fetch(youtube_id)
        return [{"text": s.text, "start": s.start, "duration": s.duration} for s in transcript]
    except (NoTranscriptFound, TranscriptsDisabled):
        try:
            transcript_list = api.list(youtube_id)
            transcript = transcript_list.find_generated_transcript(
                ["en", "en-US", "en-GB"]
            ).fetch()
            return [{"text": s.text, "start": s.start, "duration": s.duration} for s in transcript]
        except Exception:
            return []
    except Exception:
        return []


def extract_keywords(transcript: list, top_n: int = 20) -> list:
    """Simple word-frequency keyword extraction from transcript text."""
    STOPWORDS = {
        "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
        "of", "with", "by", "from", "is", "it", "this", "that", "was", "are",
        "be", "as", "we", "you", "i", "so", "if", "do", "not", "have", "has",
        "he", "she", "they", "what", "which", "who", "when", "where", "how",
        "all", "just", "can", "will", "would", "could", "should", "about",
        "up", "out", "there", "then", "than", "also", "into", "its", "our",
        "your", "like", "get", "got", "going", "okay", "yeah", "um", "uh",
    }
    words = []
    for entry in transcript:
        text = entry.get("text", "").lower()
        text = re.sub(r"[^a-z\s]", "", text)
        words.extend(w for w in text.split() if len(w) > 3 and w not in STOPWORDS)

    counts = Counter(words)
    return [word for word, _ in counts.most_common(top_n)]


def format_timestamp(seconds: float) -> str:
    seconds = int(seconds)
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"
