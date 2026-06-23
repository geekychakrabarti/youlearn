# Contributing to YouLearn

Thanks for your interest! YouLearn is a focused tool — contributions that keep it simple and distraction-free are most welcome.

## Running locally

```bash
git clone https://github.com/yourusername/youlearn.git
cd youlearn
uv sync
brew install ffmpeg          # macOS
bash run.sh
```

## Project layout

```
app/routes/     API endpoints (FastAPI)
app/db.py       SQLite schema — add tables here
app/config.py   Config loading/saving
frontend/       Plain HTML/JS/CSS — no build step
menubar.py      macOS menu bar app (rumps)
```

## Making changes

- **Backend**: Edit `app/` files, restart the server (`bash run.sh`)
- **Frontend**: Edit `frontend/` files, hard-refresh the browser (`Cmd+Shift+R`)
- **No TypeScript, no bundler** — keep it plain JS

## Principles

- **Local-first** — no cloud, no tracking, data stays on the user's machine
- **Minimal dependencies** — don't add packages without a strong reason
- **Ollama only for AI** — no OpenAI/Anthropic/Meta API calls
- **No Meta models** — use `gemma3:4b` or other non-Meta models

## Submitting a PR

1. Fork the repo
2. Create a branch: `git checkout -b feature/your-feature`
3. Test manually in the browser
4. Open a PR with a clear description of what and why

## Issues

Bug reports and feature ideas welcome. Please include:
- macOS version
- Steps to reproduce
- What you expected vs what happened
