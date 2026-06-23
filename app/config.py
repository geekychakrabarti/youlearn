import json
from pathlib import Path

_CONFIG_PATH = Path(__file__).parent.parent / "config.json"
_DEFAULT = {
    "video_folder": str(Path.home() / "Movies" / "YouLearn"),
    "video_quality": "720",
    "db_path": None,
    "youtube_api_key": None,
}

def load_config() -> dict:
    if _CONFIG_PATH.exists():
        try:
            with open(_CONFIG_PATH) as f:
                data = json.load(f)
            return {**_DEFAULT, **data}
        except Exception:
            pass
    return _DEFAULT.copy()

def save_config(updates: dict) -> None:
    """Merge updates into config.json, creating it if needed."""
    current = load_config()
    current.update(updates)
    # Don't persist None values
    to_save = {k: v for k, v in current.items() if v is not None}
    with open(_CONFIG_PATH, "w") as f:
        json.dump(to_save, f, indent=2)

def get_video_folder() -> Path:
    folder = Path(load_config()["video_folder"])
    folder.mkdir(parents=True, exist_ok=True)
    return folder

def get_video_quality() -> str:
    return load_config().get("video_quality", "720")

def resolve_video_path(filename: str) -> Path | None:
    """Resolve a relative filename to absolute path. Returns None if not found."""
    if not filename:
        return None
    folder = get_video_folder()
    path = folder / filename
    return path if path.exists() else None
