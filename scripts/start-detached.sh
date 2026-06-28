#!/usr/bin/env bash
#
# image-to-prompt — start-detached.sh
# ---------------------------------------------------------------------------
# Background launcher used by the desktop icon. Behaviour mirrors the
# gestuo-tools pattern:
#
#   1. Kills any stale `node server.js` for this repo (so port 3100 is free).
#   2. Starts `npm start` in the background, redirecting logs to .data/start.log.
#   3. Polls http://localhost:${PORT}/api/health until the server is ready.
#   4. Opens the browser at http://localhost:${PORT} via xdg-open.
#   5. Exits — leaving the dev server running detached.
#
# Logs are tailable: `tail -f /home/david/shadowdog-dev/projects/image-to-prompt/.data/start.log`.
# Stop the server: `pkill -f "node server.js"` from this repo dir, or click
# the image-to-prompt-stop.desktop shortcut if you make one.
# ---------------------------------------------------------------------------
set -euo pipefail

readonly SCRIPT_NAME="Image-to-Prompt"
readonly DEFAULT_PORT=3100
readonly READINESS_TIMEOUT_SEC=45
readonly REPO_ROOT="/home/david/shadowdog-dev/projects/image-to-prompt"
readonly LOG_FILE="${REPO_ROOT}/.data/start.log"

PORT="${PORT:-${DEFAULT_PORT}}"
URL="http://localhost:${PORT}"

notify() {
  if command -v notify-send &>/dev/null; then
    notify-send -i image-to-prompt "$SCRIPT_NAME" "$1" || true
  fi
}

# --- kill any stale server for this repo so PORT is free ---
pkill -f "node server.js" 2>/dev/null || true
pkill -f "npm.*start" 2>/dev/null || true
sleep 1

# --- check if already running ---
if curl -fsS -o /dev/null -m 2 "${URL}/api/health" 2>/dev/null; then
  notify "Opening existing session…"
  xdg-open "${URL}" >/dev/null 2>&1 || true
  exit 0
fi

mkdir -p "${REPO_ROOT}/.data"

# --- start detached ---
notify "Starting server…"
(
  cd "${REPO_ROOT}"
  nohup npm start >"${LOG_FILE}" 2>&1 &
  disown || true
) </dev/null

# --- poll for readiness ---
ready=0
for ((i = 0; i < READINESS_TIMEOUT_SEC; i++)); do
  if curl -fsS -o /dev/null -m 2 "${URL}/api/health" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "${ready}" -ne 1 ]]; then
  notify "Failed to start within ${READINESS_TIMEOUT_SEC}s — tail ${LOG_FILE}"
  exit 1
fi

notify "Server ready — opening browser"
xdg-open "${URL}" >/dev/null 2>&1 || true
exit 0