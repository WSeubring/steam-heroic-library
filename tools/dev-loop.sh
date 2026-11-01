#!/bin/bash
# One development round: build the plugin, fully restart Steam with DevTools on,
# then report what the plugin did. Prints everything needed to debug the round.
#
# Usage: tools/dev-loop.sh [seconds to watch, default 30]
set -euo pipefail

cd "$(dirname "$0")/.."
WATCH=${1:-30}
LOG=~/.local/share/Steam/logs/console-linux.txt
DEVTOOLS="python3 -I tools/devtools.py"

echo "== build"
(cd plugin && bun run build) 2>&1 | tail -5 | grep -v Core_ReloadPlugin || true

echo "== restart Steam"
# Millennium deletes this flag at startup, so set it before every launch.
touch ~/.steam/steam/.cef-enable-remote-debugging
steam -shutdown >/dev/null 2>&1 || true
for _ in $(seq 30); do pgrep -x steam >/dev/null || break; sleep 1; done
if pgrep -x steam >/dev/null; then echo "Steam did not quit"; exit 1; fi
start_line=$(wc -l < "$LOG")
setsid -f gtk-launch steam >/dev/null 2>&1
for _ in $(seq 60); do curl -s --max-time 1 http://127.0.0.1:8080/json >/dev/null && break; sleep 1; done

echo "== plugin console for ${WATCH}s"
$DEVTOOLS watch "$WATCH" || true

echo "== backend log"
tail -n +"$start_line" "$LOG" | grep -iE "heroic-steam-install|main\.lua|ERROR" \
	| grep -viE "gameoverlayrenderer|Core_ReloadPlugin|axios|gogdl|\[Gog\]" | cut -c1-240 | tail -20 || true

echo "== page script"
$DEVTOOLS eval "window.__heroicInstall ? window.__heroicInstall.debug() : 'NOT INJECTED'"
