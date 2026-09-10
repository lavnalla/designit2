#!/usr/bin/env bash
# Start / stop / restart the fabric pipeline service.
#
#   ./service.sh start | stop | restart | status | logs
#
# Backgrounding this from Windows-side tooling needs `setsid` plus an explicit
# </dev/null: a plain `nohup ... &` leaves stdin at EOF, which uvicorn's
# reloader and some CLIs read as a shutdown signal, and the server dies a few
# seconds after reporting that it started.
set -uo pipefail

SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SERVICE_DIR")"
PORT="${FABRIC_SERVICE_PORT:-8010}"
LOG="/tmp/fabric-service.log"
PYTHON="$SERVICE_DIR/.venv/bin/python"

pids() {
  # Match on the app-dir rather than the port so this never matches the shell
  # that is running this script.
  pgrep -f "uvicorn server:app --app-dir fabric-pipeline-service" || true
}

case "${1:-status}" in
  start)
    if [ -n "$(pids)" ]; then
      echo "already running: $(pids | tr '\n' ' ')"
      exit 0
    fi
    cd "$REPO_ROOT"
    setsid nohup "$PYTHON" -m uvicorn server:app \
      --app-dir fabric-pipeline-service \
      --host 127.0.0.1 --port "$PORT" \
      > "$LOG" 2>&1 < /dev/null &
    disown
    sleep 8
    if [ -n "$(pids)" ]; then
      echo "started on 127.0.0.1:$PORT (pid $(pids | tr '\n' ' '))"
    else
      echo "failed to start; last lines of $LOG:"
      tail -20 "$LOG"
      exit 1
    fi
    ;;
  stop)
    P="$(pids)"
    if [ -z "$P" ]; then
      echo "not running"
      exit 0
    fi
    kill $P
    sleep 3
    P="$(pids)"
    if [ -n "$P" ]; then
      kill -9 $P
      sleep 1
    fi
    echo "stopped"
    ;;
  restart)
    "$0" stop
    "$0" start
    ;;
  status)
    P="$(pids)"
    if [ -z "$P" ]; then
      echo "not running"
      exit 1
    fi
    echo "running (pid $P)"
    curl -s --max-time 20 "http://127.0.0.1:$PORT/health" && echo
    ;;
  logs)
    tail -"${2:-40}" "$LOG"
    ;;
  *)
    echo "usage: $0 {start|stop|restart|status|logs}" >&2
    exit 2
    ;;
esac
