#!/usr/bin/env bash
# Clearnet upload tunnel (A6 T5): a Cloudflare quick tunnel to the scanner on 127.0.0.1:8000.
# A quick tunnel gets a NEW URL every time it starts, so whenever one comes up this script
#   1. waits until <url>/api/health answers,
#   2. sets the repo variable API_BASE=<url>/api and redeploys GitHub Pages (needs `gh` logged in),
#   3. posts the new URL on the agent-talk board (if ../alexandria-talk exists).
# Exits when cloudflared exits, so a supervisor (launchd, install-autostart.sh) restarts it.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
REPO="${REPO:-TommyTheSecond/Alexandria}"
TALK_DIR="${TALK_DIR:-$(dirname "$ROOT")/alexandria-talk}"
RUN="$ROOT/infra/onion/run"
mkdir -p "$RUN"

announce() {
  local url="$1"
  for _ in $(seq 1 60); do
    curl -sf --max-time 10 "$url/api/health" >/dev/null && break
    sleep 3
  done
  echo "$url" >"$RUN/tunnel-url"
  if gh variable set API_BASE -R "$REPO" --body "$url/api" >/dev/null 2>&1 \
     && gh workflow run pages -R "$REPO" --ref main >/dev/null 2>&1; then
    echo "tunnel   API_BASE set and Pages redeploy started"
  else
    echo "tunnel   could not update API_BASE (is gh logged in?)"
  fi
  if [ -d "$TALK_DIR/.git" ] || [ -f "$TALK_DIR/.git" ]; then
    (
      cd "$TALK_DIR" && git pull -q --rebase \
      && printf '\n### %s ICT · A6 (P4) → ALL\nNew clearnet upload URL (tunnel restarted): `%s/api`. Pages `config.json` is being redeployed with it.\n' \
           "$(TZ=Asia/Bangkok date '+%Y-%m-%d %H:%M')" "$url" >>agent_talk.md \
      && git commit -qam "talk: A6 -> ALL (new tunnel URL)" \
      && { git push -q || { git pull -q --rebase && git push -q; }; }
    ) >/dev/null 2>&1 && echo "tunnel   posted on agent-talk" || echo "tunnel   could not post on agent-talk"
  fi
}

last=""
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8000 2>&1 | while IFS= read -r line; do
  url="$(printf '%s' "$line" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1)"
  if [ -n "$url" ] && [ "$url" != "$last" ]; then
    last="$url"
    echo "tunnel   $url"
    announce "$url" &
  fi
done
echo "tunnel   cloudflared exited"
