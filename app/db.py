import sqlite3
import json
from pathlib import Path


def _resolve_db_path() -> Path:
    """Use db_path from config.json if set and drive is mounted, else fall back to local."""
    local = Path(__file__).parent.parent / "data" / "youlearn.db"
    try:
        config_file = Path(__file__).parent.parent / "config.json"
        if config_file.exists():
            cfg = json.loads(config_file.read_text())
            db_path = cfg.get("db_path")
            if db_path:
                p = Path(db_path)
                # Use drive DB if the drive is mounted (parent dir exists)
                if p.parent.exists():
                    return p
    except Exception:
        pass
    return local


DB_PATH = _resolve_db_path()

SCHEMA = """
CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    topic TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    youtube_id TEXT NOT NULL,
    title TEXT DEFAULT '',
    duration_seconds INTEGER DEFAULT 0,
    thumbnail TEXT DEFAULT '',
    transcript_json TEXT DEFAULT '[]',
    tags_json TEXT DEFAULT '[]',
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
    timestamp_seconds REAL NOT NULL,
    end_seconds REAL,
    label TEXT DEFAULT '',
    type TEXT DEFAULT 'highlight' CHECK(type IN ('highlight','question','skip','note','extract')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
    timestamp_seconds REAL,
    body TEXT NOT NULL,
    is_question INTEGER DEFAULT 0,
    source TEXT DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    parent_id INTEGER REFERENCES tags(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS video_tags (
    video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (video_id, tag_id)
);

CREATE TABLE IF NOT EXISTS trusted_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    thumbnail TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS video_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
    start_seconds REAL NOT NULL,
    end_seconds REAL NOT NULL,
    concept_label TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""


def get_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript(SCHEMA)
    # Migrations for columns added after initial release
    for migration in [
        "ALTER TABLE notes ADD COLUMN source TEXT DEFAULT 'user'",
    ]:
        try:
            conn.execute(migration)
        except Exception:
            pass  # Column already exists
    conn.commit()
    conn.close()


def row_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)


def rows_to_list(rows) -> list:
    return [dict(r) for r in rows]


def parse_json_fields(record: dict, fields: list) -> dict:
    for f in fields:
        if f in record and isinstance(record[f], str):
            try:
                record[f] = json.loads(record[f])
            except (json.JSONDecodeError, TypeError):
                record[f] = []
    return record
