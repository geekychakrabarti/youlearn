# YouLearn — Distraction-free learning

**YouLearn** is a local-first video learning tool that lets you study YouTube videos without the algorithm pulling you away. Build a curated library, take timestamped notes, search transcripts, and let AI suggest what to learn next — all stored on your own machine.

> Inspired by [Longcut](https://github.com/SamuelZ12/longcut) and [longcut.ai](https://www.longcut.ai)

---

## Features

- **Library** — Curated playlists of YouTube videos, downloaded locally for instant seeking
- **Discover** — Search YouTube with operators (`from:channel`, `duration:short`, `order:views`) — no recommendations, no rabbit holes
- **Transcripts** — Full scrollable transcript synced to playback, searchable with `in:transcripts`
- **Clips & Notes** — Smart clip (C) captures the current semantic phase; manual range (M), notes (N), questions (Q), skip zones (S)
- **All tab** — Chapters, clips, notes and questions in one chronological timeline
- **Similar Projects** — Find related videos at the same difficulty level using semantic tags
- **What's next?** — AI-powered suggestions for what to learn next based on your questions and watched videos
- **Theatre mode** — Full-width video (T key) with no distractions
- **Study Sheet export** — Download your chapters, questions and notes as Markdown
- **Search history** — Your last 10 Discover searches remembered
- **Onboarding tour** — 7-step guided tour on first launch

---

## Requirements

- macOS 12+ (Windows support coming)
- [uv](https://docs.astral.sh/uv/) — Python package manager
- [ffmpeg](https://ffmpeg.org/) — for video downloads
- [Ollama](https://ollama.com/) *(optional)* — for AI features

---

## Quick Start

### Option A — Mac App (recommended)

1. Download and open the `YouLearn.app` bundle
2. On first launch, macOS may show a security warning (app is unsigned): **Right-click → Open → Open**
3. YouLearn appears in your menu bar — the server starts automatically and your browser opens

### Option B — Terminal

```bash
# 1. Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. Clone the repo
git clone https://github.com/geekychakrabarti/youlearn.git
cd youlearn

# 3. Install ffmpeg
brew install ffmpeg

# 4. Run
bash run.sh
```

Open [http://localhost:8000](http://localhost:8000) in your browser.

---

## Configuration

Copy `config.example.json` to `config.json` and edit as needed:

```json
{
  "video_folder": "~/Movies/YouLearn",
  "video_quality": "720",
  "db_path": null,
  "youtube_api_key": null
}
```

| Field | Default | Description |
|---|---|---|
| `video_folder` | `~/Movies/YouLearn` | Where downloaded videos are stored |
| `db_path` | same folder as videos | Path to SQLite DB. `null` = use video folder. |
| `video_quality` | `720` | Download quality: `360`, `480`, `720`, `1080` |
| `youtube_api_key` | `null` | Optional. Enables view counts and native sort. Get one free at [console.cloud.google.com](https://console.cloud.google.com) |

**Via menu bar:** Click the YouLearn icon → **📁 Set Storage Location…** to choose a folder with a native macOS picker.

---

## AI Features (Ollama)

AI features are optional and run fully locally — no data leaves your machine.

```bash
# 1. Install Ollama from https://ollama.com
# 2. Pull the model (we use gemma3 — no Meta/Llama models)
ollama pull gemma3:4b
```

Once running, YouLearn automatically uses Ollama for:
- **Semantic tags** — topic tags generated from transcripts
- **Chapter summaries** — hover over a chapter to see a summary
- **What's next?** — AI-suggested next topics based on your questions and watched videos

If Ollama is not running, these features show a clear install message and everything else works normally.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `C` | Clip semantic phase (idea boundary — instant) |
| `M` | Manual highlight range (tap twice for start/end) |
| `N` | Note at current time |
| `Q` | Question at current time |
| `S` | Skip zone (tap twice) |
| `J` / `K` | Previous / next marker |
| `[` / `]` | Navigate transcript search matches |
| `Space` | Play / pause |
| `←` / `→` | ±5 seconds |
| `T` | Theatre mode (hide panels) |
| `Escape` | Exit theatre mode / cancel pending mark |
| `?` / `/` | Show all shortcuts |

---

## Search Operators

### Library search
| Operator | Example | Effect |
|---|---|---|
| *(plain text)* | `geometry nodes` | Filter by title and semantic tags |
| `in:transcripts` | `camera view in:transcripts` | Search transcript text |
| `in:current` | `mesh in:transcripts in:current` | Scope to active playlist |

### Discover search
| Operator | Example | Effect |
|---|---|---|
| `from:` | `from:BlenderGuru` | Scope to a creator |
| `duration:short` | `blender duration:short` | Videos under 4 min |
| `duration:medium` | `houdini duration:medium` | 4–20 min |
| `duration:long` | `vex duration:long` | Over 20 min |
| `order:views` | `geometry nodes order:views` | Sort by most viewed |
| `order:recent` | `houdini order:recent` | Sort by newest |
| `category:education` | `python category:education` | Filter to educational content |

---

## Project Structure

```
youlearn/
├── app/                    # FastAPI backend
│   ├── routes/             # API routes
│   ├── db.py               # SQLite schema
│   ├── config.py           # Config loading/saving
│   └── transcript.py       # yt-dlp metadata
├── frontend/               # Vanilla JS + CSS
│   ├── app.js              # Application logic
│   ├── style.css           # Dark theme
│   ├── tour.js             # Onboarding tour
│   └── index.html          # Single-page app
├── menubar.py              # macOS menu bar (rumps)
├── config.example.json     # Config template
├── run.sh / stop.sh        # Server control
└── pyproject.toml          # Python dependencies
```

---

## Development

```bash
uv sync                                              # install deps
uv run uvicorn app.main:app --port 8000 --reload    # dev server
uv run python menubar.py                             # menu bar app
```

The frontend is plain HTML/JS — no build step. Edit `frontend/` and refresh.

---

## License

MIT — see [LICENSE](LICENSE). Fork it, build on it, make it your own.

---

## Documentation

- [User Guide](docs/USER_GUIDE.md) — screen-by-screen guide to every feature
- [Technical Documentation](docs/TECHNICAL.md) — architecture, API reference, feature internals, database schema

---

## Acknowledgements

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — YouTube downloading
- [Ollama](https://ollama.com/) — local AI inference  
- [rumps](https://github.com/jaredks/rumps) — macOS menu bar
- [FastAPI](https://fastapi.tiangolo.com/) — backend
- [Longcut](https://github.com/SamuelZ12/longcut) — inspiration
