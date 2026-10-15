#!/usr/bin/env bash
# One-time setup so the onion host runs the relayer (A2) next to the scanner (A3).
#   infra/onion/setup-relayer.sh
# Creates relayer/.env and scanner/.env from their examples, generates one shared RELAY_SECRET
# into both (never printed), and points both at Fuji. You paste only RELAYER_PRIVATE_KEY
# (testnet key from P1, via a password manager) into relayer/.env afterwards. Safe to re-run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
for f in relayer/.env.example scanner/.env.example; do
  [ -f "$f" ] || { echo "$f not on this branch yet"; exit 1; }
done

umask 077
for svc in relayer scanner; do
  [ -f "$svc/.env" ] || cp "$svc/.env.example" "$svc/.env"
  chmod 600 "$svc/.env"
done

value() { grep -E "^$1=" "$2" | head -1 | cut -d= -f2-; }
set_var() { # set_var NAME VALUE FILE (replaces NAME= line or appends)
  local tmp; tmp="$(mktemp)"
  awk -v k="$1" -v v="$2" 'BEGIN{d=0} $0 ~ "^"k"=" {print k"="v; d=1; next} {print} END{if(!d) print k"="v}' "$3" >"$tmp"
  cat "$tmp" >"$3"; rm -f "$tmp"
}

secret="$(value RELAY_SECRET relayer/.env)"
[ -n "$secret" ] || secret="$(value RELAY_SECRET scanner/.env)"
[ -n "$secret" ] || secret="$(openssl rand -hex 32)"
set_var RELAY_SECRET "$secret" relayer/.env
set_var RELAY_SECRET "$secret" scanner/.env
unset secret

[ -n "$(value RPC_URL relayer/.env)" ] || set_var RPC_URL https://api.avax-test.network/ext/bc/C/rpc relayer/.env
[ -n "$(value DEPLOYMENT relayer/.env)" ] || set_var DEPLOYMENT ../deployments/fuji.json relayer/.env
[ -n "$(value ALEXANDRIA_REQUIRE_CLAMAV scanner/.env)" ] || set_var ALEXANDRIA_REQUIRE_CLAMAV 1 scanner/.env

echo "relayer/.env and scanner/.env ready; they share one RELAY_SECRET (not shown)."
if [ -z "$(value RELAYER_PRIVATE_KEY relayer/.env)" ]; then
  echo "Next: paste the relayer's testnet key into relayer/.env as RELAYER_PRIVATE_KEY=0x..."
fi
[ -f deployments/fuji.json ] || echo "Waiting for deployments/fuji.json (A1's Fuji deployment) before the relayer can start."
