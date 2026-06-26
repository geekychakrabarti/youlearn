# YouLearn — Technical Documentation

## Architecture Overview

YouLearn is a single-machine web application. A FastAPI server runs locally and serves a single-page HTML/JS frontend. All data is stored in SQLite. No cloud services are required.

```
Browser (Safari/Chrome)
    ↕ HTTP (localhost:8000)
FastAPI server (uvicorn)
    ↕
SQLite database + local video files
    ↕ (optional)
Ollama (local AI, port 11434)
    ↕ (optional)
YouTube Data API v3
```

**Stack:**
- Backend: Python 3.9+, FastAPI, uvicorn, yt-dlp, SQLite
- Frontend: Vanilla JS, CSS (no framework, no build step)
- AI: Ollama with gemma3:4b (local, optional)
- macOS wrapper: rumps (menu bar app)

---

## Database Schema

All data lives in a single SQLite file. Path: `~/Movies/YouLearn/youlearn.db` (or configured via `config.json`).

```sql
playlists (id, name, description, topic, created_at, last_active_video_id)
videos    (id, playlist_id, url, youtube_id, title, duration_seconds, thumbnail,
           transcript_json, tags_json, semantic_tags_json, learning_type,
           chapters_json, channel, added_at, last_position_seconds,
           local_path, download_status)
clips     (id, video_id, timestamp_seconds, end_seconds, label, type, ollama_refined, created_at)
notes     (id, video_id, timestamp_seconds, body, is_question, source, created_at)
tags      (id, name, parent_id)
video_tags(video_id, tag_id)
trusted_channels (id, channel_id, name, thumbnail, notes, created_at)
video_segments   (id, video_id, start_seconds, end_seconds, concept_label, created_at)
```

**Clip types:** `highlight`, `question`, `skip`, `note`, `extract`

**Note source values:** `user` (Q-key), `ollama` (AI-detected — currently suppressed)

**Learning types (Ollama-generated):** `project_tutorial`, `concept_explainer`, `tips_tricks`, `comparison`, `showcase`

---

## API Reference

Base URL: `http://localhost:8000`

### Playlists
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/playlists` | List all playlists |
| POST | `/api/playlists` | Create playlist |
| PATCH | `/api/playlists/{id}` | Update name/description/topic |
| DELETE | `/api/playlists/{id}` | Delete playlist and its videos |
| PATCH | `/api/playlists/{id}/last-video` | Update last active video |

### Videos
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/videos?playlist_id=&search=&duration=&order=&order_dir=` | List videos with filters |
| POST | `/api/videos` | Add video by URL (triggers background download) |
| DELETE | `/api/videos/{id}` | Remove video |
| GET | `/api/videos/transcript_raw?youtube_id=` | Raw transcript entries |
| GET | `/api/videos/chapters?youtube_id=` | Chapter list (DB or live yt-dlp) |
| GET | `/api/videos/yt-tags?youtube_id=` | Semantic or YouTube tags |
| GET | `/api/videos/semantic-tags?youtube_id=` | Generate tags via Ollama |
| GET | `/api/videos/summaries?youtube_id=` | Chapter summaries via Ollama |
| POST | `/api/videos/refine-clip` | Refine clip edges via Ollama |

### Clips & Notes
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/clips` | Create clip |
| PATCH | `/api/clips/{id}` | Update clip |
| DELETE | `/api/clips/{id}` | Delete clip |
| POST | `/api/notes` | Create note/question |
| PATCH | `/api/notes/{id}` | Update note |
| DELETE | `/api/notes/{id}` | Delete note |
| POST | `/api/notes/detect-questions` | Detect questions in transcript via Ollama (suppressed) |

### Segments
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/segments?youtube_id=` | Get cached semantic segments (triggers background generation if none) |
| POST | `/api/segments/generate` | Force (re-)generate segments for a video |

### Search
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/search/youtube?q=&channel=&channel_id=&duration=&order=` | Search YouTube |
| GET | `/api/search/transcript?q=&playlist_id=&limit=` | Search stored transcripts |
| POST | `/api/search/similar` | Find similar videos via Ollama |

### AI / Learning
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/learn/whats-next` | AI-suggested next topics (Ollama) |

### Config
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config` | Current config (no API key) |
| POST | `/api/config/storage` | Update video/DB storage path |

### Export
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/export/playlist/{id}/markdown` | Study Sheet (Markdown) |
| GET | `/api/export/playlist/{id}/json` | Full export (JSON) |

---

## Feature Internals

### Video Download Pipeline

1. `POST /api/videos` receives a YouTube URL
2. Metadata fetched via `yt-dlp` (title, duration, thumbnail, channel, chapters)
3. Transcript fetched via `youtube-transcript-api`
4. Download enqueued in background thread (`downloads.py`)
5. `download_status` progresses: `none` → `downloading` → `complete` / `failed`
6. Frontend polls `/api/downloads/status/{video_id}` every 3s
7. When complete, video plays from local file via `/api/downloads/file/{video_id}`

If local file is missing (e.g. external drive not mounted), the frontend silently falls back to the YouTube iframe.

### Semantic Tags (Ollama)

Generated on demand when a video is opened:

1. Check DB for existing `semantic_tags_json`
2. If absent, extract first 3000 chars of `transcript_json`
3. POST to `http://localhost:11434/api/generate` with gemma3:4b
4. Prompt asks for 4–6 topic tags + learning type
5. Result cached in `videos.semantic_tags_json` and `videos.learning_type`

Model: `gemma3:4b` (enforced — no Meta/Llama models).

### What's Next? (AI Learning Loop)

`POST /api/learn/whats-next`:
1. Fetches all questions (`notes.is_question=1`) for the user's library
2. Fetches semantic tags from watched videos
3. Builds a context string: video titles + topic tags + questions marked
4. Sends to Ollama: "Given this learning context, suggest 4 next topics with search queries"
5. Returns `{ suggestions: [{ topic, reason, search }] }`
6. Frontend renders each suggestion with a "↩ Search" button that fires a Discover search

### Transcript Search

**In-app (Chapters tab):**
- Searches `previewTranscript` array client-side
- Matches stored as indices in `state.tsearchMatches`
- `[` / `]` keys navigate matches, seeking the video player
- Matched spans highlighted with `.match` CSS class

**Library search with `in:transcripts`:**
- Calls `GET /api/search/transcript?q=&playlist_id=`
- Backend searches `transcript_json` (stored as JSON array of `{text, start, duration}`)
- Returns timestamped snippets with highlighted matches
- Clicking a result: fetches video by ID, activates its playlist, seeks to timestamp

### Similar Projects

From a Library video's title bar (`↩ Similar projects` button):
1. Reads `semantic_tags_json` from the video (top 2 tags)
2. If absent, calls `/api/videos/yt-tags` which returns semantic tags or falls back to yt-dlp YouTube tags
3. Builds query: `channel_name + top_2_tags + duration_bracket`
4. Fires `runDiscoverSearch()` with that query
5. Switches panel to Discover, pauses video, clears notes panel
6. "← Back to search" bar saves previous results for restore

### Channel Search (channel_id based)

When a user clicks a channel name on a Discover card:
1. `state.discoverChannelId` is set to the YouTube channel ID (from API response)
2. `runDiscoverSearch()` passes `channel_id` as query param
3. Backend passes `channelId` to YouTube API — returns only that channel's videos
4. Sort resets to `relevance` to avoid misleading sort labels

### Theatre Mode

CSS-only toggle via `document.body.classList.toggle('theatre-mode')`:
```css
body.theatre-mode #library-panel,
body.theatre-mode #notes-panel { display: none; }
body.theatre-mode { grid-template-columns: 0 1fr 0; }
body.theatre-mode #player-panel { grid-column: 1 / -1; }
```
Triggered by: `T` key, `⤢` button in transport bar. Exits with `Escape` or `T`.

### Onboarding Tour

`frontend/tour.js` — standalone module:
- `TOUR_STEPS` array: each step has `target` (CSS selector), `title`, `desc`, `position`, and optional `onEnter`/`onLeave` hooks
- `onEnter` used to switch tabs (e.g. step 7 switches to Discover tab)
- Spotlight: `box-shadow: 0 0 0 9999px rgba(0,0,0,0.55)` on the spotlight element
- Target element gets `.tour-active-target` class (lifted above backdrop)
- Tooltip z-index: 10001 (above backdrop at 9999)
- State: `localStorage.yl_tour_done = '1'` after completion
- Relaunchable via: menu bar "? Start Tour" → opens `#start-tour` hash → `window.startTour()`

### Semantic Video Segmentation (C key Smart Clip)

On video open, the full transcript is sent to Ollama (`gemma3:12b`) once to divide the video into semantic phases:

1. `GET /api/segments?youtube_id=` checks `video_segments` table
2. If empty, triggers `_generate_segments_bg()` in a daemon thread and returns `generating: true`
3. Background function sends full timestamped transcript to Ollama with a segmentation prompt
4. Ollama returns 5-16 contiguous segments: `{start, end, label}`
5. Segments cached in `video_segments` table

When the user presses **C**:
- Frontend looks up `state.videoSegments` for the segment containing the current playhead
- Creates a highlight clip with exact `start_seconds` / `end_seconds` from the segment — no per-clip Ollama call
- Falls back to transcript entry boundary if segments not yet ready

New videos also trigger `_generate_segments_bg` automatically via `_enrich_video()`.

### Search History


Discover searches saved to `localStorage.yl_search_history` (max 10 entries):
- Saved on every manual search (not related searches)
- `state._isRelatedSearch` flag captured before resetting to correctly skip programmatic searches
- Rendered in the operator hint dropdown on input focus
- Click to re-run instantly

### macOS Menu Bar App (`menubar.py`)

Built with `rumps`. Menu items:
- **▶ Open YouLearn** — opens browser (starts server if needed)
- **? Start Tour** — opens `http://localhost:8000#start-tour`
- **📖 Help & Documentation** — opens `#open-help` hash
- **📁 Set Storage Location…** — native macOS folder picker via `osascript`, writes to `config.json`
- **● Running on port 8000** — status indicator
- **Quit YouLearn** — kills server, tab closes via heartbeat

**Tab close mechanism:** Frontend polls `/api/playlists` every 3s. After 2 missed beats, calls `window.close()`.

---

## Configuration

See `config.example.json`. Config is loaded by `app/config.py` on each request (not cached — allows hot updates). `save_config()` merges updates without losing existing keys.

Default `video_folder`: `~/Movies/YouLearn`  
Default `db_path`: `null` → uses `video_folder/youlearn.db`

---

## Adding a New Feature

1. **Backend route:** Add to `app/routes/` or extend an existing route file. Register in `app/main.py`.
2. **Frontend:** Edit `frontend/app.js`. No build step — save and hard-refresh (`Cmd+Shift+R`).
3. **DB schema change:** Add `CREATE TABLE IF NOT EXISTS` or `ALTER TABLE` to `app/db.py SCHEMA`. Run `init_db()` (called on server start).
4. **Test:** Use Playwright via `mcp__playwright__browser_evaluate` or browser DevTools.

---

## Known Limitations

- macOS only (Windows support planned — see `#39`)
- App not code-signed — first launch requires Right-click → Open
- Local video playback requires external drive to be mounted if `video_folder` is on one
- Ollama AI features require `gemma3:4b` — `ollama pull gemma3:4b` before first use
- YouTube API key optional but recommended for accurate view counts and native sorting
