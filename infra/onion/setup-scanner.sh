#!/usr/bin/env bash
# One-time setup on the onion host so start.sh can run the scanner (A3) with ClamAV.
#   infra/onion/setup-scanner.sh
# Creates .venv (Python 3.11+), installs scanner/requirements.txt, installs ClamAV and its
# virus database. Safe to re-run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

[ -f scanner/requirements.txt ] || { echo "scanner/requirements.txt not on this branch yet (A3)"; exit 1; }

PY="${PYTHON:-python3}"
"$PY" -c 'import sys; assert sys.version_info >= (3, 11), sys.version' || { echo "need Python 3.11+ (set PYTHON=...)"; exit 1; }
[ -x .venv/bin/python ] || "$PY" -m venv .venv
.venv/bin/python -m pip install -q --upgrade pip
.venv/bin/python -m pip install -q -r scanner/requirements.txt
echo "python   .venv ready ($(.venv/bin/python --version))"

if ! command -v clamscan >/dev/null; then
  if command -v brew >/dev/null; then brew install clamav
  elif command -v apt-get >/dev/null; then sudo apt-get install -y clamav clamav-daemon
  else echo "install ClamAV yourself, then re-run"; exit 1
  fi
fi

# Homebrew ships only a sample freshclam.conf; it refuses to run while the "Example" line is there.
if command -v brew >/dev/null; then
  ETC="$(brew --prefix)/etc/clamav"
  if [ ! -f "$ETC/freshclam.conf" ]; then
    sed 's/^Example/#Example/' "$ETC/freshclam.conf.sample" >"$ETC/freshclam.conf"
  fi
fi
freshclam --quiet || echo "freshclam failed; check the ClamAV database before accepting uploads"
echo "clamav   $(clamscan --version)"
echo
echo "Done. Restart infra/onion/start.sh to start the scanner with ClamAV required."
