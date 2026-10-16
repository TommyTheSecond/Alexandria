#!/usr/bin/env bash
# Runs pin-sync (dry run: pins only, never unpins) and publish-snapshot every 15 minutes (A6 T4).
# Use during H+14 – H+20 on the onion host, next to infra/onion/start.sh:
#   infra/scripts/sync-loop.sh            every 15 minutes
#   INTERVAL=60 infra/scripts/sync-loop.sh
# Unpinning (pin-sync --apply) is never automatic: run it by hand after asking P4.
# The snapshot goes to a gitignored file (not the committed snapshots/latest.json), so the host
# checkout stays clean for `git pull`; the onion's reader gets it as its catalog.json.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
INTERVAL="${INTERVAL:-900}"
export SNAPSHOT_FILE="${SNAPSHOT_FILE:-$ROOT/infra/onion/run/snapshot/latest.json}"
SITE="$ROOT/infra/onion/run/site"
ENV=()
[ -f infra/.env ] && ENV=(--env-file=infra/.env)

while true; do
  echo "=== $(TZ=Asia/Bangkok date '+%Y-%m-%d %H:%M ICT')"
  node "${ENV[@]}" infra/scripts/pin-sync.mjs || echo "pin-sync failed (see above); retrying next round"
  node "${ENV[@]}" contracts/script/filebase-cleanup.mjs || echo "filebase-cleanup failed (see above); retrying next round"
  if node "${ENV[@]}" infra/scripts/publish-snapshot.mjs; then
    # The onion serves the reader built by infra/onion/build-site.sh; give it the newest snapshot.
    if [ -f "$SITE/index.html" ] && [ -s "$SNAPSHOT_FILE" ]; then cp "$SNAPSHOT_FILE" "$SITE/catalog.json"; fi
  else
    echo "publish-snapshot failed (see above); retrying next round"
  fi

  # Phase 1: Paid nodes check and epoch closing (disabled by default for hackathon; set ENABLE_FUND=1 to enable)
  if [ "${ENABLE_FUND:-0}" = "1" ] && [ -f "$ROOT/deployments/fuji-fund.json" ]; then
    NODECHECK_STATE="$ROOT/infra/onion/run/nodecheck"
    TARGETS_FILE="$NODECHECK_STATE/targets.json"

    node "${ENV[@]}" infra/scripts/node-targets.mjs || echo "node-targets failed; retrying next round"
    if [ -f "$TARGETS_FILE" ]; then
      python -m scanner.nodecheck probe --targets "$TARGETS_FILE" --state "$NODECHECK_STATE" || echo "nodecheck probe failed; retrying next round"
    fi
    node "${ENV[@]}" infra/scripts/close-epoch.mjs || echo "close-epoch failed; retrying next round"
  fi

  # Phase 2: book bounties (I9). Proposes payouts for U-Bot-matched uploads and executes them after the
  # dispute window. Only once the bounty contract is deployed; a failure never affects the steps above.
  if [ -f "$ROOT/deployments/fuji-bounties.json" ]; then
    node "${ENV[@]}" infra/scripts/bounty-resolver.mjs || echo "bounty-resolver failed; retrying next round"
  fi
  sleep "$INTERVAL"
done
