#!/bin/bash
# YouLearn Menu Bar — double-click to run in your Mac menu bar
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
exec uv run python menubar.py
