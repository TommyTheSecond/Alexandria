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

# Scanner (A3) on 127.0.0.1:8000 with no access log, from the repo root (it reads schemas/).
# Uses .venv (infra/onion/setup-scanner.sh) when present. Override with SCANNER_CMD.
# ClamAV is required on the server: a missing scanner rejects uploads instead of skipping (A3).
export ALEXANDRIA_REQUIRE_CLAMAV=1
PY="python3"; [ -x "$ROOT/.venv/bin/python" ] && PY="$ROOT/.venv/bin/python"
SCANNER_CMD="${SCANNER_CMD:-}"
if [ -z "$SCANNER_CMD" ] && [ -f scanner/app.py ]; then
  SCANNER_CMD="$PY -m uvicorn scanner.app:app --host 127.0.0.1 --port 8000 --no-access-log"
fi
if [ -n "$SCANNER_CMD" ]; then
  $SCANNER_CMD >"$RUN/scanner.log" 2>&1 & pids+=($!)
  echo "scanner  starting (log: infra/onion/run/scanner.log)"
else
  echo "scanner  not built yet: /api/* returns 502 until it is"
fi
echo "relayer  start it yourself on 127.0.0.1:8787 (P1/A2); it holds a hot key"

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
