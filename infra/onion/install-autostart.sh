#!/usr/bin/env bash
# Makes the onion host come back by itself (macOS): launchd starts the onion stack, the upload
# tunnel and the 15-minute sync loop at login, and restarts any of them that stops.
#   infra/onion/install-autostart.sh              install and start now
#   infra/onion/install-autostart.sh --uninstall  stop and remove
#   infra/onion/install-autostart.sh --print      show the generated plists, change nothing
# Logs: ~/Library/Logs/alexandria/{onion,tunnel,sync}.log
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/alexandria"
PATH_VALUE="/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
NAMES=(onion tunnel sync)
script_for() { case "$1" in onion) echo "$ROOT/infra/onion/start.sh" ;; tunnel) echo "$ROOT/infra/onion/tunnel.sh" ;; sync) echo "$ROOT/infra/scripts/sync-loop.sh" ;; esac; }

plist() { # plist NAME
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>org.alexandria.$1</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$(script_for "$1")</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH_VALUE</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOGS/$1.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$1.log</string>
</dict>
</plist>
PLIST
}

case "${1:-}" in
  --print)
    for n in "${NAMES[@]}"; do echo "== $AGENTS/org.alexandria.$n.plist"; plist "$n"; done ;;
  --uninstall)
    for n in "${NAMES[@]}"; do
      launchctl bootout "gui/$(id -u)/org.alexandria.$n" 2>/dev/null || true
      rm -f "$AGENTS/org.alexandria.$n.plist"
    done
    echo "autostart removed" ;;
  "")
    mkdir -p "$AGENTS" "$LOGS"
    for n in "${NAMES[@]}"; do
      f="$AGENTS/org.alexandria.$n.plist"
      launchctl bootout "gui/$(id -u)/org.alexandria.$n" 2>/dev/null || true
      plist "$n" >"$f"
      plutil -lint -s "$f"
      launchctl bootstrap "gui/$(id -u)" "$f"
    done
    echo "autostart installed: onion, tunnel, sync start now and at every login; launchd restarts them if they stop."
    echo "logs: $LOGS" ;;
  *) echo "usage: $0 [--print|--uninstall]"; exit 2 ;;
esac
