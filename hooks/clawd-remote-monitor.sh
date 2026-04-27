#!/usr/bin/env sh
# Clawd Desktop Pet — remote monitor supervisor
# Starts/stops the Codex remote JSONL monitor on an SSH host.

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MONITOR_JS="$SCRIPT_DIR/codex-remote-monitor.js"
PID_FILE="$SCRIPT_DIR/codex-remote-monitor.pid"
LOG_FILE="$SCRIPT_DIR/codex-remote-monitor.log"
PORT="${CLAWD_REMOTE_PORT:-23333}"
ENV_FILE="$SCRIPT_DIR/clawd-remote-env"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi

NODE_BIN="${CLAWD_NODE_BIN:-${NODE_BIN:-node}}"

is_running() {
  [ -f "$PID_FILE" ] || return 1
  pid=$(cat "$PID_FILE" 2>/dev/null || true)
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

start_monitor() {
  if is_running; then
    echo "Clawd Codex remote monitor already running (pid $(cat "$PID_FILE"))."
    return 0
  fi

  if [ ! -f "$MONITOR_JS" ]; then
    echo "ERROR: missing $MONITOR_JS" >&2
    return 1
  fi

  mkdir -p "$SCRIPT_DIR"
  nohup "$NODE_BIN" "$MONITOR_JS" --port "$PORT" >> "$LOG_FILE" 2>&1 &
  pid=$!
  echo "$pid" > "$PID_FILE"

  sleep 1
  if is_running; then
    echo "Clawd Codex remote monitor started (pid $pid, log $LOG_FILE)."
    return 0
  fi

  echo "ERROR: Clawd Codex remote monitor failed to start. See $LOG_FILE" >&2
  rm -f "$PID_FILE"
  return 1
}

stop_monitor() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "Clawd Codex remote monitor is not running."
    return 0
  fi

  pid=$(cat "$PID_FILE")
  kill "$pid" 2>/dev/null || true
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  echo "Clawd Codex remote monitor stopped."
}

status_monitor() {
  if is_running; then
    echo "running $(cat "$PID_FILE")"
  else
    rm -f "$PID_FILE"
    echo "stopped"
  fi
}

case "${1:-status}" in
  start)
    start_monitor
    ;;
  stop)
    stop_monitor
    ;;
  restart)
    stop_monitor
    start_monitor
    ;;
  status)
    status_monitor
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}" >&2
    exit 2
    ;;
esac
