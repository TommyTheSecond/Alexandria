#!/usr/bin/env bash
# Alexandria Community Node Starter Kit (D4-3)
# Starts a local Kubo node (with Gateway.NoFetch = true), sets up Tor hidden service
# or Cloudflare quick tunnel, and runs pin-sync every 15 minutes.
set -euo pipefail

NODE_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$NODE_DIR/../.." && pwd)"
STATE_DIR="$NODE_DIR/run"

mkdir -p "$STATE_DIR/ipfs" "$STATE_DIR/tor"

echo "=== Alexandria Node Setup ==="

# 1. Initialize Kubo IPFS repo if not present
if [ ! -f "$STATE_DIR/ipfs/config" ]; then
  echo "Initializing IPFS repository..."
  IPFS_PATH="$STATE_DIR/ipfs" ipfs init --profile server
  # Do not fetch unpinned blocks from the DHT on gateway requests
  IPFS_PATH="$STATE_DIR/ipfs" ipfs config --json Gateway.NoFetch true
  IPFS_PATH="$STATE_DIR/ipfs" ipfs config Addresses.Gateway "/ip4/127.0.0.1/tcp/8080"
  IPFS_PATH="$STATE_DIR/ipfs" ipfs config Addresses.API "/ip4/127.0.0.1/tcp/5001"
fi

# 2. Start Kubo daemon in background
echo "Starting IPFS daemon..."
IPFS_PATH="$STATE_DIR/ipfs" ipfs daemon --enable-gc > "$STATE_DIR/ipfs.log" 2>&1 &
IPFS_PID=$!

cleanup() {
  echo "Shutting down node..."
  kill "$IPFS_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 3. Start Tor Onion Service or Cloudflare Quick Tunnel
GATEWAY_URL=""

if command -v tor >/dev/null 2>&1; then
  echo "Configuring Tor Onion Service for gateway..."
  cat <<EOF > "$STATE_DIR/tor/torrc"
DataDirectory $STATE_DIR/tor
HiddenServiceDir $STATE_DIR/tor/hs
HiddenServicePort 80 127.0.0.1:8080
EOF
  tor -f "$STATE_DIR/tor/torrc" > "$STATE_DIR/tor.log" 2>&1 &
  TOR_PID=$!
  trap 'kill $IPFS_PID $TOR_PID 2>/dev/null || true' EXIT INT TERM

  echo "Waiting for onion address..."
  for _ in {1..30}; do
    if [ -f "$STATE_DIR/tor/hs/hostname" ]; then
      GATEWAY_URL="http://$(cat "$STATE_DIR/tor/hs/hostname")"
      break
    fi
    sleep 1
  done
elif command -v cloudflared >/dev/null 2>&1; then
  echo "Starting Cloudflare quick tunnel (warning: URL changes on restart)..."
  cloudflared tunnel --url http://127.0.0.1:8080 > "$STATE_DIR/tunnel.log" 2>&1 &
  TUNNEL_PID=$!
  trap 'kill $IPFS_PID $TUNNEL_PID 2>/dev/null || true' EXIT INT TERM
  sleep 3
  GATEWAY_URL="$(grep -o 'https://[-a-z0-9.]*\.trycloudflare\.com' "$STATE_DIR/tunnel.log" | head -n 1 || true)"
fi

echo ""
echo "=========================================================="
if [ -n "$GATEWAY_URL" ]; then
  echo "Node Gateway URL: $GATEWAY_URL"
  echo "Register this gateway at: https://alexandria.library/#/nodes"
else
  echo "Local Gateway: http://127.0.0.1:8080"
  echo "Install tor or cloudflared to expose a public gateway address."
fi
echo "=========================================================="
echo ""

# 4. Run pin-sync loop every 15 minutes
export KUBO_API="http://127.0.0.1:5001"

while true; do
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Running pin-sync..."
  node "$ROOT/infra/scripts/pin-sync.mjs" || echo "pin-sync failed; will retry in 15m"
  sleep 900
done
