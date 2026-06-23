#!/bin/bash
# stop.command — double-click this file in Finder to stop YouLearn
DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$DIR/stop.sh"
echo ""
echo "Press any key to close this window."
read -n 1
