#!/usr/bin/env bash
# image-to-prompt — launcher.sh (desktop icon dispatcher)
# ---------------------------------------------------------------------------
# Mirrors the gestuo-tools invokeai-launcher.sh pattern. Sub-commands:
#   open    — start the server (if not already running) and open the browser.
#   start   — start the server, do NOT open the browser.
#   stop    — kill any running server for this repo.
#   restart — stop + start.
#   status  — print whether the server is reachable on $PORT and exit 0 / 1.
#   logs    — tail the latest start.log via x-terminal-emulator (fallback: cat).
#
# Every sub-command sets the cwd to the repo root so the desktop entry
# doesn't need to know where the repo lives beyond this script path.
# ---------------------------------------------------------------------------
set -euo pipefail

readonly SCRIPT_NAME="Image-to-Prompt"
readonly DEFAULT_PORT=3100
readonly REPO_ROOT="/home/david/shadowdog-dev/projects/image-to-prompt"
readonly LOG_FILE="${REPO_ROOT}/.data/start.log"
readonly SERVER_PID_FILE="${REPO_ROOT}/.data/server.pid"
readonly DETACHED_SH="${REPO_ROOT}/scripts/start-detached.sh"

PORT="${PORT:-${DEFAULT_PORT}}"
URL="http://localhost:${PORT}"

notify() {
  if command -v notify-send &>/dev/null; then
    notify-send -i image-to-prompt "$SCRIPT_NAME" "$1" || true
  fi
}

# Stop = kill the running node server for this repo (mirrors the
# pkill used inside start-detached.sh).
cmd_stop() {
  notify "Stopping server…"
  pkill -f "node server.js" 2>/dev/null || true
  pkill -f "npm.*start" 2>/dev/null || true
  if [[ -f "${SERVER_PID_FILE}" ]]; then
    local pid
    pid="$(cat "${SERVER_PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
    fi
    rm -f "${SERVER_PID_FILE}"
  fi
  sleep 1
  notify "Server stopped."
}

# Status = probe the local /api/health endpoint. Exit 0 / 1.
# Output is friendly-toast-friendly so notify-send can show it.
cmd_status() {
  if curl -fsS -o /dev/null -m 2 "${URL}/api/health" 2>/dev/null; then
    echo "up (${URL})"
    notify "Server is UP at ${URL}."
    exit 0
  else
    echo "down"
    notify "Server is DOWN."
    exit 1
  fi
}

# Logs = tail the latest start.log via x-terminal-emulator
# (gnome-terminal / konsole / xfce4-terminal / xterm). Falls back to
# cat if no terminal is available — minimal but informative.
cmd_logs() {
  if [[ ! -f "${LOG_FILE}" ]]; then
    echo "(no log file at ${LOG_FILE} yet)" >&2
    exit 1
  fi
  if command -v gnome-terminal &>/dev/null; then
    gnome-terminal --title="Image-to-Prompt logs" -- tail -F "${LOG_FILE}"
  elif command -v konsole &>/dev/null; then
    konsole -e "tail -F '${LOG_FILE}'"
  elif command -v xfce4-terminal &>/dev/null; then
    xfce4-terminal --title="Image-to-Prompt logs" -e "tail -F '${LOG_FILE}'"
  elif command -v xterm &>/dev/null; then
    xterm -T "Image-to-Prompt logs" -e "tail -F '${LOG_FILE}'"
  else
    tail -n 50 -F "${LOG_FILE}"
  fi
}

# Start = start without opening the browser. Mirrors start-detached.sh
# but skips the xdg-open at the end.
cmd_start() {
  exec "${DETACHED_SH}" >/dev/null 2>&1
  # start-detached.sh opens the browser; for the "Start" desktop
  # action below, the user is in a desktop context, so browser-open
  # is desirable. Both paths go through the same script.
}

# Open = start (if needed) + open the browser. This is what desktop
# click runs.
cmd_open() {
  if curl -fsS -o /dev/null -m 2 "${URL}/api/health" 2>/dev/null; then
    notify "Server is already up — opening ${URL}"
    xdg-open "${URL}" >/dev/null 2>&1 || true
    exit 0
  fi
  exec "${DETACHED_SH}"
}

# Restart = stop + open.
cmd_restart() {
  cmd_stop || true
  cmd_open
}

case "${1:-open}" in
  open)    cmd_open ;;
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  status)  cmd_status ;;
  logs)    cmd_logs ;;
  *)
    echo "usage: $0 {open|start|stop|restart|status|logs}" >&2
    exit 2
    ;;
esac
