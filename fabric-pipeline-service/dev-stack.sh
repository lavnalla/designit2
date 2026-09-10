#!/usr/bin/env bash
# Bring up everything needed to use copy/paste fabric:
#   - the fabric pipeline service (FastAPI + models) on :8010
#   - the Next.js dev server on :3000
#
#   ./dev-stack.sh up | down | status
#
# Both are started with `setsid` and stdin from /dev/null. A plain `nohup ... &`
# leaves stdin at EOF, which `next dev` reads as a shutdown signal -- it prints
# "Ready" and then quietly exits a few seconds later.
set -uo pipefail

SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SERVICE_DIR")"
NODE_BIN="/home/sajeevan/.nvm/versions/node/v24.18.0/bin"
NEXT_LOG="/tmp/nextjs-dev.log"

next_pids() {
  pgrep -f "node .*/node_modules/.bin/next dev" || true
}

start_next() {
  if [ -n "$(next_pids)" ]; then
    echo "next dev: already running (pid $(next_pids | tr '\n' ' '))"
    return 0
  fi
  export PATH="$NODE_BIN:$PATH"
  cd "$REPO_ROOT"
  # Invoke the resolved binary rather than `npm run dev`: npm sometimes shells
  # out through Windows cmd.exe against the UNC path, which cannot handle it.
  setsid nohup ./node_modules/.bin/next dev \
    > "$NEXT_LOG" 2>&1 < /dev/null &
  disown

  for _ in $(seq 1 40); do
    sleep 1
    if curl -s -o /dev/null --max-time 3 http://localhost:3000/ 2>/dev/null; then
      echo "next dev: ready on http://localhost:3000 (pid $(next_pids | tr '\n' ' '))"
      return 0
    fi
  done
  echo "next dev: did not come up; last lines of $NEXT_LOG:"
  tail -20 "$NEXT_LOG"
  return 1
}

stop_next() {
  P="$(next_pids)"
  if [ -z "$P" ]; then echo "next dev: not running"; return 0; fi
  kill $P 2>/dev/null
  sleep 3
  P="$(next_pids)"
  [ -n "$P" ] && kill -9 $P 2>/dev/null
  echo "next dev: stopped"
}

case "${1:-status}" in
  up)
    "$SERVICE_DIR/service.sh" start || exit 1
    # Load both models now so the first Copy Fabric is not a cold start.
    # Retried: uvicorn can still be binding when service.sh returns, and a
    # single attempt then fails silently and leaves the models cold.
    for _ in $(seq 1 10); do
      if curl -s -X POST --max-time 300 http://127.0.0.1:8010/warm | grep -q '"ok":true'; then
        echo "models: warm"
        break
      fi
      sleep 2
    done
    start_next || exit 1
    echo
    echo "ready -> http://localhost:3000/studio"
    ;;
  down)
    stop_next
    "$SERVICE_DIR/service.sh" stop
    ;;
  status)
    "$SERVICE_DIR/service.sh" status
    echo
    P="$(next_pids)"
    if [ -n "$P" ]; then
      echo "next dev: running (pid $P)"
      curl -s -o /dev/null -w "  http://localhost:3000 -> %{http_code}\n" --max-time 10 http://localhost:3000/
    else
      echo "next dev: not running"
    fi
    ;;
  *)
    echo "usage: $0 {up|down|status}" >&2
    exit 2
    ;;
esac
