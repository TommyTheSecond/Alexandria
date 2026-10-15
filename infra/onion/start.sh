#!/usr/bin/env bash
# Starts the onion mirror (A6 T1): Kubo, the scanner if it exists, Caddy and Tor.
# Run from anywhere: infra/onion/start.sh   Ctrl-C stops everything.
# Every service listens on 127.0.0.1 only. Tor is the only way in.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
RUN="$ROOT/infra/onion/run"
export IPFS_PATH="$ROOT/infra/kubo"
mkdir -p "$RUN"

pids=()
cleanup() {
  trap - EXIT INT TERM
  [ ${#pids[@]} -gt 0 ] && kill "${pids[@]}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

need() { command -v "$1" >/dev/null || { echo "missing: $1 (README 9.1 B6)"; exit 1; }; }
need ipfs; need caddy; need tor

# Keep the Mac awake while this runs (README 14: the onion host must not sleep).
if command -v caffeinate >/dev/null; then caffeinate -dimsu -w $$ & fi

# Kubo: gateway 127.0.0.1:8080, API 127.0.0.1:5001 (never exposed).
# NoFetch: the gateway serves only content pinned on this node, so the onion
# is not an open proxy to the whole IPFS network.
if [ ! -f "$IPFS_PATH/config" ]; then ipfs init --profile server >/dev/null; fi
ipfs config Addresses.API /ip4/127.0.0.1/tcp/5001
ipfs config Addresses.Gateway /ip4/127.0.0.1/tcp/8080
ipfs config --json Gateway.NoFetch true
ipfs daemon >"$RUN/kubo.log" 2>&1 & pids+=($!)
echo "kubo     starting (log: infra/onion/run/kubo.log)"

# Relayer (A2) on 127.0.0.1:8787: unlocks P1's encrypted keystore (#31) with a mode-600 password file.
envval() { grep -E "^$1=" relayer/.env 2>/dev/null | head -1 | cut -d= -f2-; }
KS="$(envval RELAYER_KEYSTORE)"; PW="$(envval RELAYER_PASSWORD_FILE)"
RELAYER_READY=0
if [ -f relayer/package.json ] && [ -f deployments/fuji.json ] && [ -n "$KS" ] && [ -f "$KS" ] && [ -n "$PW" ] && [ -s "$PW" ]; then
  RELAYER_READY=1
fi

# Scanner (A3) on 127.0.0.1:8000 with no access log, from the repo root (it reads schemas/).
# Uses .venv (infra/onion/setup-scanner.sh) when present. Override with SCANNER_CMD.
# ClamAV is required on the server: a missing scanner rejects uploads instead of skipping (A3).
export ALEXANDRIA_REQUIRE_CLAMAV=1
PY="python3"; [ -x "$ROOT/.venv/bin/python" ] && PY="$ROOT/.venv/bin/python"
SCANNER_CMD_OVERRIDE="${SCANNER_CMD:-}"
SCANNER_CMD="${SCANNER_CMD:-}"
if [ -z "$SCANNER_CMD" ] && [ -f scanner/app.py ]; then
  SCANNER_CMD="$PY -m uvicorn scanner.app:app --host 127.0.0.1 --port 8000 --no-access-log"
fi
if [ -n "$SCANNER_CMD" ] && [ -z "${SCANNER_CMD_OVERRIDE:-}" ] && ! "$PY" -c "import scanner.app" >/dev/null 2>&1; then
  echo "scanner  NOT started: its Python packages are missing or outdated."
  echo "         Fix: infra/onion/setup-scanner.sh, then restart this script."
elif [ -n "$SCANNER_CMD" ] && [ "$RELAYER_READY" = 1 ]; then
  $SCANNER_CMD >"$RUN/scanner.log" 2>&1 & pids+=($!)
  echo "scanner  starting (log: infra/onion/run/scanner.log)"
elif [ -n "$SCANNER_CMD" ]; then
  # No relayer: an empty RELAY_SECRET keeps /api/submit off (503), so nothing is pinned without reaching the chain.
  RELAY_SECRET= $SCANNER_CMD >"$RUN/scanner.log" 2>&1 & pids+=($!)
  echo "scanner  starting, uploads OFF until the relayer runs (scan only)"
else
  echo "scanner  not built yet: /api/* returns 502 until it is"
fi

if [ "$RELAYER_READY" = 1 ]; then
  pnpm --filter @alexandria/relayer start >"$RUN/relayer.log" 2>&1 & pids+=($!)
  echo "relayer  starting (log: infra/onion/run/relayer.log)"
else
  echo "relayer  not started: run infra/onion/setup-relayer.sh and add the keystore + password it asks for"
fi

# Caddy on 127.0.0.1:8088: the reader build, or the test page until it exists.
export SITE_ROOT="$ROOT/apps/reader/dist"
[ -f "$SITE_ROOT/index.html" ] || SITE_ROOT="$ROOT/infra/onion/test-site"
caddy run --config infra/onion/Caddyfile --adapter caddyfile >"$RUN/caddy.log" 2>&1 & pids+=($!)
echo "caddy    serving $SITE_ROOT"

# Tor: the onion's private key lives in infra/tor/hs (gitignored).
mkdir -p infra/tor/hs infra/tor/data
chmod 700 infra/tor/hs infra/tor/data
tor -f infra/onion/torrc >"$RUN/tor.log" 2>&1 & pids+=($!)

for _ in $(seq 1 60); do
  [ -s infra/tor/hs/hostname ] && break
  sleep 1
done
if [ -s infra/tor/hs/hostname ]; then
  echo
  echo "onion    http://$(cat infra/tor/hs/hostname)/"
  echo "         (reachable once Tor finishes publishing, usually under a minute)"
else
  echo "tor      no hostname yet; see infra/onion/run/tor.log"
fi
echo
echo "Running. Ctrl-C stops everything."
wait
