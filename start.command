#!/bin/bash
# YouLearn.command — double-click this file in Finder to start YouLearn
# (macOS requires .command files to be executable: chmod +x YouLearn.command)

DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$DIR/run.sh"

# Keep terminal window open so you can see logs / press Ctrl+C to stop
echo ""
echo "Press Ctrl+C to stop YouLearn."
wait
