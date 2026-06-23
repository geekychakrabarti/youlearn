# YouLearn — User Guide

YouLearn is a distraction-free video learning tool. You curate what you watch, mark what matters, and let AI help you figure out what to learn next — all without YouTube's algorithm pulling you away.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Library Tab](#library-tab)
3. [Discover Tab](#discover-tab)
4. [Video Player](#video-player)
5. [Notes Panel](#notes-panel)
6. [Transcript Search](#transcript-search)
7. [Similar Projects](#similar-projects)
8. [What's Next? (AI)](#whats-next-ai)
9. [Exporting Your Notes](#exporting-your-notes)
10. [Theatre Mode](#theatre-mode)
11. [Search Operators](#search-operators)
12. [Keyboard Shortcuts](#keyboard-shortcuts)
13. [Menu Bar](#menu-bar)
14. [Settings](#settings)

---

## Getting Started

When you first open YouLearn, you'll see:

- **Left panel** — Library (your playlists and videos) or Discover (YouTube search)
- **Centre** — Video player
- **Right panel** — Notes, clips, chapters and AI tools

**First time?** A guided tour walks you through the main features. You can restart it anytime from the menu bar icon → **? Start Tour**, or via the **?** button → **↺ Restart tour**.

---

## Library Tab

The Library is your personal collection of YouTube videos, organised into playlists.

### Playlists

**Create a playlist:** Click the **+** button in the top-right of the Library panel.

**Rename a playlist:** Hover over the playlist name, then click the **✎** button that appears.

**Collapse / expand:** Click the **▾** arrow next to the playlist name to hide its video list.

**Delete:** Hover and click the **🗑** button. This removes the playlist and all its videos from YouLearn (the files on your drive are left intact).

### Adding Videos

**From Discover:** Find a video in Discover, click **＋ Add**, choose a playlist.

**By URL:** Hover over a playlist name, click **+ Add**, paste a YouTube URL.

YouLearn downloads the video in the background. A green dot (●) next to the video title means it's downloaded and ready for local playback. While downloading, the dot is grey.

### Searching Your Library

Type in the search box at the top of the Library panel to filter by title and topic tags.

**Advanced search operators:**

| What you type | What it does |
|---|---|
| `geometry nodes` | Filter videos by title or topic |
| `camera view in:transcripts` | Search the actual spoken words in videos |
| `mesh in:transcripts in:current` | Search transcripts, but only in the current playlist |

Results show how many matches each playlist has. Playlists with zero matches are hidden automatically.

**Clear search:** Click the **✕** button next to the search box, or delete the text.

### Sorting Videos

Use the **Sort** row below the search box:

- **Newest** — most recently added first (click again for Oldest)
- **Title** — A→Z (click again for Z→A)
- **Duration** — shortest first (click again for longest first)

### Filtering by Tag

Topic tags appear below the sort row. Click a tag to filter. Click multiple tags to show only videos that match all of them (AND logic). Each active tag gets its own **✕** to remove it individually.

---

## Discover Tab

Discover lets you search YouTube without distractions. No autoplay, no recommendations sidebar — just search results you can preview and add to your library.

### Searching

Type in the search box and press **⌕** or **Enter**.

Your last 10 searches are remembered. Click the search box to see them.

**Operators you can use:**

| Operator | Example | Effect |
|---|---|---|
| `from:` | `from:BlenderGuru` | Only videos from this creator |
| `duration:short` | `blender duration:short` | Under 4 minutes |
| `duration:medium` | `houdini duration:medium` | 4–20 minutes |
| `duration:long` | `vex duration:long` | Over 20 minutes |
| `order:views` | `nodes order:views` | Sort by most viewed |
| `order:recent` | `houdini order:recent` | Sort by newest |

### Cards

Each result card shows the video title, duration, view count, and channel name.

- **Click anywhere on the card** → opens a preview in the player
- **＋ Add** → adds to a playlist (you choose which one)
- **▶ Preview** → opens the video preview
- **Channel name** → searches for more videos from that creator
- **✕** → removes this card from the current results

### Preview

When a card is previewing:
- The video plays in the centre panel
- The right panel shows **Chapters** and transcript
- The preview bar shows: **↩ Channel** (more from this creator) and **↩ Related videos** (similar topic)
- **＋ Add to playlist** — save it to your library
- **✕ Close** — dismiss the preview

### Sort & Filter

Below the search box:
- **Duration** filter — All / <10m / 10-30m / 30m+ / Custom
- **Sort** — Relevant / Most Viewed ↓↑ / Recent ↓↑ (click active button to reverse)

### Following Creators

Click **+ Follow** on any card to follow a creator. Following pills appear at the top of Discover. Click a pill to search that creator's content. Click **×** on a pill to unfollow.

### Back to Search

After clicking a related button (↩ Channel or ↩ Related videos), a **← Back to search** bar appears. Click it to return to your previous search results.

---

## Video Player

### Playback Controls

The transport bar at the bottom contains:

| Button | Action |
|---|---|
| ⏮ | Jump to previous marker (or start) |
| ◀5s | Rewind 5 seconds |
| ▶ / ⏸ | Play / Pause |
| 5s▶ | Skip forward 5 seconds |
| ⏭ | Jump to next marker |
| Mark | Highlight range (tap twice) |
| Note | Add a note at current time |
| Question | Mark a question at current time |
| Skip | Mark a skip zone (tap twice) |
| ⤢ | Theatre mode (full width) |

### Marking as You Learn

While a video plays, you can mark moments without stopping:

- **M** — Start/end a highlight range (yellow bar on timeline)
- **N** — Add a note at the current timestamp
- **Q** — Mark a question (orange triangle)
- **S** — Start/end a skip zone (grey bar — fast-forward through boring parts)

All marks appear instantly on the timeline and in the Notes panel.

### Timeline

The coloured bar below the video shows:
- **Yellow bars** — highlight ranges
- **Orange triangles** — questions
- **Green dots** — notes
- **Grey bars** — skip zones
- **Chapter markers** — grey triangles (hover to see name)
- **Transcript search dots** — small dots when transcript search is active

Click anywhere on the timeline to seek.

### J / K Keys

With a video open, **J** and **K** step through all markers in time order (chapters, clips, notes, questions). This lets you review your annotations without using the mouse.

---

## Notes Panel

The right panel organises everything you've captured from a video.

### Tabs

- **All** — every chapter, clip, note and question in time order. Click any item to jump to that moment.
- **Clips** — your highlight and skip ranges. Click to seek.
- **Notes** — your timestamped notes. Click to seek.
- **Questions** — questions you've marked. Click to seek.
- **Chapters** — the video's chapters (from YouTube). Click to seek.

Icons match the timeline: ■ gold = clip, ■ red = skip, ● green = note, ▲ orange = question, ▲ grey = chapter.

### Export Buttons

When a video is open, **⬇ Study Sheet** and **⬇ JSON** appear in the Notes panel header.

- **Study Sheet** — Markdown file with chapters, questions and notes, all with clickable timestamps
- **JSON** — Full export of all your data for that playlist

### What's Next?

The **✦ What's next?** button (requires Ollama) analyses your questions and watched topics, then suggests 4 next things to learn. Each suggestion includes a search query you can fire directly into Discover.

---

## Transcript Search

Inside the **Chapters** tab, a search box lets you search for any word spoken in the video.

**How to use:**
1. Click the **Chapters** tab
2. Type a word in the "Search transcript…" box
3. Press **⌕** — matching moments are highlighted and the video seeks to the first one
4. Press **]** to jump to the next match, **[** for the previous one
5. The status shows "2 / 11 — [ ] to navigate"

You can also select any text in the transcript and click the **✂ Clip** button that appears to create a clip at those timestamps.

---

## Similar Projects

When you're watching a Library video, click **↩ Similar projects** in the title bar (next to the video title).

YouLearn uses the video's semantic topic tags and duration to search Discover for related content at the same level. The feed populates and a **← Back to search** bar lets you return to your previous Discover state.

Useful when you finish a tutorial and want to find what to watch next on the same topic.

---

## What's Next? (AI)

Requires [Ollama](https://ollama.com) running with `gemma3:4b`.

Click **✦ What's next?** in the Notes panel header at any time.

YouLearn analyses:
- The questions you've marked across your library (Q marks)
- The semantic topics of videos you've watched

Ollama then suggests 4 specific next topics to explore, each with a reason and a ready-to-use Discover search query. Click **↩ Search** on any suggestion to find videos on that topic.

**If Ollama isn't running**, the panel shows installation instructions. AI features are completely optional — everything else works without it.

---

## Exporting Your Notes

With a video open, click **⬇ Study Sheet** in the Notes panel header.

The exported Markdown file includes:
- Playlist name and topic
- Each video with a link to YouTube
- **Chapters** with timestamps (links jump to that moment on YouTube)
- **Questions** you marked, with timestamps
- **Notes** you took, with timestamps

The file is saved to the `exports/` folder in your YouLearn directory and opens automatically.

**JSON export** includes everything: clips, notes, questions, chapters, tags — useful for importing into other tools.

---

## Theatre Mode

Press **T** or click the **⤢** button (far right of the transport bar) to hide both side panels and fill the screen with video.

Press **T** or **Escape** to return to normal view.

All keyboard shortcuts (J/K, M, N, Q, S, [ ]) still work in theatre mode.

---

## Search Operators

### Library

| Operator | Example | What it searches |
|---|---|---|
| *(none)* | `geometry` | Video titles and AI-generated topic tags |
| `in:transcripts` | `camera view in:transcripts` | Spoken words in transcripts |
| `in:current` | `mesh in:transcripts in:current` | Transcripts within the active playlist only |

Operators can be combined: `keyframe animation in:transcripts in:current`

When searching transcripts, results show a snippet of context around the match. Click a result to open the video at that timestamp.

### Discover

| Operator | Example | What it does |
|---|---|---|
| `from:channel` | `from:CGMatter` | Videos from a specific creator |
| `duration:short` | `blender duration:short` | Under 4 minutes |
| `duration:medium` | — | 4–20 minutes |
| `duration:long` | — | Over 20 minutes |
| `order:views` | `houdini order:views` | Sort by most viewed |
| `order:recent` | `vex order:recent` | Sort by newest |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `M` | Highlight range — press once to start, once to end |
| `N` | Note at current timestamp |
| `Q` | Question at current timestamp |
| `S` | Skip zone — press once to start, once to end |
| `J` | Previous marker (chapter, clip, note or question) |
| `K` | Next marker |
| `[` | Previous transcript search match |
| `]` | Next transcript search match |
| `Space` | Play / Pause |
| `←` | Rewind 5 seconds |
| `→` | Skip forward 5 seconds |
| `T` | Toggle theatre mode |
| `Escape` | Exit theatre mode |
| `?` | Show all shortcuts overlay |

---

## Menu Bar

Click the YouLearn icon (three-step staircase) in your macOS menu bar:

| Item | Action |
|---|---|
| ▶ Open YouLearn | Open the browser tab (starts server if needed) |
| ? Start Tour | Launch the guided onboarding tour |
| 📖 Help & Documentation | Open the in-app help panel |
| 📁 Set Storage Location… | Choose where videos and your database are stored |
| ● Running on port 8000 | Status indicator |
| Quit YouLearn | Stop the server and close the browser tab |

When you quit, the browser tab closes automatically within a few seconds.

---

## Settings

### Storage Location

By default, YouLearn saves videos and your database to `~/Movies/YouLearn`.

**To change it:**
1. Click the YouLearn menu bar icon
2. Click **📁 Set Storage Location…**
3. Choose a folder (external drive works well for large libraries)
4. Restart YouLearn to apply

You can also edit `config.json` directly (see `config.example.json` for the format).

### YouTube API Key (optional)

Without an API key, search works via yt-dlp but without view counts or advanced sorting.

**To add one:**
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project → Enable "YouTube Data API v3"
3. Create credentials → API key (Public data)
4. Add to `config.json`: `"youtube_api_key": "your-key-here"`

### Video Quality

Default download quality is 720p. Change in `config.json`:
```json
"video_quality": "1080"
```
Options: `360`, `480`, `720`, `1080`

---

## Tips & Tricks

- **Clip from transcript** — In the Chapters tab, select any text in the transcript. A **✂ Clip** button appears — click it to create a clip at exactly those timestamps.

- **Follow creators** — Use **+ Follow** in Discover to build a trusted creator list. Their content is one click away from the Following pills.

- **Sort by duration when exploring** — Use `Duration ↑` sort to find bite-sized videos first, then step up to longer ones as you go deeper.

- **Mark questions aggressively** — The more questions you mark, the better **✦ What's next?** suggestions become. Think of Q marks as your learning edge.

- **Study Sheet for review** — After finishing a playlist, export the Study Sheet and review it before moving to the next topic. Questions with timestamps are clickable — they take you straight back to that moment in the video.

- **`in:transcripts` is powerful** — If you half-remember something from a video ("that thing about proximity nodes"), searching `proximity in:transcripts` will find it even if the video title doesn't mention it.
