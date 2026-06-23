#!/bin/bash
# Stop YouLearn server
DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$DIR/data/server.pid"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    rm "$PID_FILE"
    echo "YouLearn stopped (PID $PID)"
  else
    rm "$PID_FILE"
    echo "YouLearn was not running"
  fi
else
  # Fallback: kill by port
  PID=$(lsof -ti tcp:8000)
  if [ -n "$PID" ]; then
    kill $PID
    echo "YouLearn stopped"
  else
    echo "YouLearn is not running"
  fi
fi
