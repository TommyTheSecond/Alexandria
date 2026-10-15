#!/usr/bin/env bash
# Builds the reader for the onion mirror (A6 T1) into infra/onion/run/site (gitignored), which Caddy serves.
#   infra/onion/build-site.sh          build only if HEAD changed since the last build
#   infra/onion/build-site.sh --force  always rebuild
# Builds from a clean `git archive` of HEAD, so the host checkout never picks up build changes and
# `git pull` keeps working. Writes the onion's own config.json: uploads go to the onion's /api, never
# to the clearnet tunnel (a Tor user's upload must not leave Tor). Keeps the previous build on failure.
# start.sh runs this in the background after every (re)start, so `git pull` + restart updates the site.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
RUN="$ROOT/infra/onion/run"
SITE="$RUN/site"
STAMP="$RUN/site.commit"
LOG="$RUN/site-build.log"
mkdir -p "$RUN"

for d in /opt/homebrew/opt/node@20/bin /usr/local/opt/node@20/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH

[ -f apps/reader/package.json ] || { echo "site     no apps/reader yet; serving the test page"; exit 0; }
command -v pnpm >/dev/null || { echo "site     not built: pnpm not found (Node 20 + corepack, README 9.1 B6)"; exit 1; }

HEAD="$(git rev-parse HEAD)"
if [ "${1:-}" != "--force" ] && [ -f "$SITE/index.html" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$HEAD" ]; then
  echo "site     reader up to date (${HEAD:0:7})"
  exit 0
fi

SRC="$(mktemp -d "$RUN/site-src.XXXXXX")"
trap 'rm -rf "$SRC"' EXIT
git archive HEAD | tar -x -C "$SRC"
echo "site     building the reader at ${HEAD:0:7} (log: infra/onion/run/site-build.log)"
# Same install as CI and the Pages workflow.
if ! ( cd "$SRC" && pnpm install --no-frozen-lockfile && pnpm --filter @alexandria/reader build ) >"$LOG" 2>&1; then
  echo "site     build FAILED at ${HEAD:0:7}; still serving the previous build (see $LOG)"
  exit 1
fi
DIST="$SRC/apps/reader/dist"
[ -f "$DIST/index.html" ] || { echo "site     build produced no index.html; still serving the previous build"; exit 1; }

# The onion's runtime config: committed values, the onion's own hostname, and uploads on the same origin.
ONION=""
[ -s infra/tor/hs/hostname ] && ONION="$(cat infra/tor/hs/hostname)"
ONION="$ONION" node --input-type=module -e "
  import { readFileSync, writeFileSync } from 'node:fs';
  const committed = JSON.parse(readFileSync('infra/config/config.json', 'utf8'));
  const onion = process.env.ONION || committed.onion;
  writeFileSync(process.argv[1], JSON.stringify({ ...committed, apiBase: '/api', onion }, null, 2) + '\n');
" "$DIST/config.json"

# The newest snapshot from the sync loop, if there is one (else the build's committed catalog).
if [ -s "$RUN/snapshot/latest.json" ]; then cp "$RUN/snapshot/latest.json" "$DIST/catalog.json"; fi

mkdir -p "$SITE"
rsync -a --delete "$DIST/" "$SITE/"
echo "$HEAD" >"$STAMP"
echo "site     reader built at ${HEAD:0:7} and served from infra/onion/run/site"
