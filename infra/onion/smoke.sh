#!/usr/bin/env bash
# Checks the running onion stack (A6 T1 "done when"). Run after start.sh is up.
#   infra/onion/smoke.sh          checks 127.0.0.1:8088
#   infra/onion/smoke.sh --tor    also fetches the same routes over the onion address
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export IPFS_PATH="$ROOT/infra/kubo"
fail=0
pass() { echo "PASS  $1"; }
miss() { echo "FAIL  $1"; fail=1; }

check_routes() { # $1 = base URL, rest = extra curl args
  local base="$1"; shift
  local page
  page="$(curl -fsS "$@" "$base/")"
  if echo "$page" | grep -q 'id="app"'; then pass "$base/ serves the reader"
  elif echo "$page" | grep -q ALEXANDRIA; then miss "$base/ serves the test page, not the reader (see infra/onion/run/site-build.log)"
  else miss "$base/ serves the site"; fi
  # A Tor user's upload must stay on the onion: the reader's config must point at /api, not the tunnel.
  curl -fsS "$@" "$base/config.json" | grep -qE '"apiBase": *"/api"' \
    && pass "$base/config.json keeps uploads on the onion (/api)" \
    || miss "$base/config.json does not set apiBase to /api"

  local got
  got="$(curl -fsS "$@" "$base/ipfs/$CID" | shasum -a 256 | cut -d' ' -f1)"
  [ "$got" = "$SHA" ] && pass "$base/ipfs/<cid> returns the pinned bytes" || miss "$base/ipfs/<cid> returns the pinned bytes"

  got="$(curl -fsS "$@" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$base/rpc")"
  echo "$got" | grep -q '"0xa869"' && pass "$base/rpc answers chainId 0xa869" || miss "$base/rpc answers chainId 0xa869 (got: $got)"

  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "$@" "$base/api/health")"
  case "$code" in
    200) pass "$base/api/health reaches the scanner" ;;
    502) echo "SKIP  $base/api/health: scanner not running yet (502)" ;;
    *) miss "$base/api/health returned $code" ;;
  esac
}

# A pinned test file, so /ipfs/ is checked against known bytes.
TMP="$(mktemp)"
printf 'alexandria onion smoke test\n' >"$TMP"
CID="$(ipfs add -Q --cid-version=1 "$TMP")"
SHA="$(shasum -a 256 "$TMP" | cut -d' ' -f1)"
rm -f "$TMP"

check_routes "http://127.0.0.1:8088"

if [ "${1:-}" = "--tor" ]; then
  ONION="$(cat infra/tor/hs/hostname)"
  check_routes "http://$ONION" --socks5-hostname 127.0.0.1:9052 --max-time 60
fi

exit $fail
