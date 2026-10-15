"""av.clamav. Set ALEXANDRIA_REQUIRE_CLAMAV=1 on the server so a missing ClamAV rejects instead of skipping."""

from __future__ import annotations

import os
import shutil
import subprocess
from typing import Callable, Optional

from .base import ScanCheck, fail, ok

Runner = Callable[[bytes], "tuple[int, str]"]
TIMEOUT_S = 120


def find_clamav() -> Optional[list[str]]:
    """Available scanners, fastest first (clamdscan needs the daemon; clamscan works alone)."""
    found = [p for p in (shutil.which("clamdscan"), shutil.which("clamscan")) if p]
    return found or None


def _runner_for(binaries: list[str]) -> Runner:
    def run(data: bytes) -> tuple[int, str]:
        rc, out = 2, "no scanner ran"
        for binary in binaries:
            proc = subprocess.run([binary, "--no-summary", "-"], input=data, capture_output=True, timeout=TIMEOUT_S)
            rc, out = proc.returncode, (proc.stdout + proc.stderr).decode("utf-8", "replace").strip()
            if rc in (0, 1):
                break
        return rc, out
    return run


def av_clamav(data: bytes, runner: Optional[Runner] = None,
              find: Callable[[], Optional[list[str]]] = find_clamav) -> ScanCheck:
    if runner is None:
        binaries = find()
        if not binaries:
            if os.environ.get("ALEXANDRIA_REQUIRE_CLAMAV") == "1":
                return fail("av.clamav", "reject", "ClamAV is required but not installed")
            return ok("av.clamav", "reject", "skipped: ClamAV not installed")
        runner = _runner_for(binaries)
    try:
        rc, out = runner(data)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return fail("av.clamav", "review", f"ClamAV error: {type(exc).__name__}")
    if rc == 0:
        return ok("av.clamav", "reject", "clean")
    if rc == 1:
        return fail("av.clamav", "reject", "malware found: " + (out.splitlines() or [""])[-1])
    return fail("av.clamav", "review", f"ClamAV error (exit {rc}); a curator must check this file")
