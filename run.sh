#!/bin/bash
# YouLearn — start the server and open the browser
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8000
URL="http://localhost:$PORT"

# Check if already running
if lsof -ti tcp:$PORT > /dev/null 2>&1; then
  echo "YouLearn is already running at $URL"
  open "$URL"
  exit 0
fi

echo "Starting YouLearn..."
cd "$DIR"

# Start server in background, log to data/server.log
uv run uvicorn app.main:app --port $PORT > "$DIR/data/server.log" 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > "$DIR/data/server.pid"

# Wait for server to be ready (up to 10s)
for i in $(seq 1 20); do
  if curl -s "$URL/api/playlists" > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "YouLearn running at $URL (PID $SERVER_PID)"
echo "Logs: $DIR/data/server.log"
open "$URL"
