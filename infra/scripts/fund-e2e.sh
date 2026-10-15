#!/usr/bin/env bash
# Runs end-to-end integration test for fund and nodecheck (D4-2).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node infra/scripts/fund-e2e.mjs
