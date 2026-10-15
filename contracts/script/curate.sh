#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f .env ]]; then
  exec node --env-file=.env script/curate.mjs "$@"
fi
exec node script/curate.mjs "$@"
