#!/usr/bin/env bash
# Runs pin-sync (dry run: pins only, never unpins) and publish-snapshot every 15 minutes (A6 T4).
# Use during H+14 – H+20 on the onion host, next to infra/onion/start.sh:
#   infra/scripts/sync-loop.sh            every 15 minutes
#   INTERVAL=60 infra/scripts/sync-loop.sh
# Unpinning (pin-sync --apply) is never automatic: run it by hand after asking P4.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
INTERVAL="${INTERVAL:-900}"
ENV=()
[ -f infra/.env ] && ENV=(--env-file=infra/.env)

while true; do
  echo "=== $(TZ=Asia/Bangkok date '+%Y-%m-%d %H:%M ICT')"
  node "${ENV[@]}" infra/scripts/pin-sync.mjs || echo "pin-sync failed (see above); retrying next round"
  node "${ENV[@]}" infra/scripts/publish-snapshot.mjs || echo "publish-snapshot failed (see above); retrying next round"
  sleep "$INTERVAL"
done
