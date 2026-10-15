"""Probe registered node gateways and record check results."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import random
import time
from typing import Any, Optional
from urllib.parse import urlparse

import httpx

MAX_RESPONSE_SIZE = 40 * 1024 * 1024  # 40 MB
DEFAULT_TIMEOUT = 30.0  # 30 seconds
DEFAULT_TOR_PROXY = "socks5://127.0.0.1:9052"


def is_onion_url(url: str) -> bool:
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    return hostname.endswith(".onion")


def probe_single(
    operator_address: str,
    gateway: str,
    probe: dict[str, Any],
    client: Optional[httpx.Client] = None,
) -> dict[str, Any]:
    cid = probe["cid"]
    expected_sha256 = probe["sha256"].lower()
    if not expected_sha256.startswith("0x"):
        expected_sha256 = f"0x{expected_sha256}"

    gateway_clean = gateway.rstrip("/")
    url = f"{gateway_clean}/ipfs/{cid}"

    start_time = time.monotonic()
    ok = False
    error: Optional[str] = None

    try:
        if client is not None:
            # Caller-provided client (e.g. in unit tests)
            resp = client.get(url, timeout=DEFAULT_TIMEOUT, follow_redirects=True)
            elapsed_ms = int((time.monotonic() - start_time) * 1000)
            if resp.status_code != 200:
                error = f"HTTP {resp.status_code}"
            elif len(resp.content) > MAX_RESPONSE_SIZE:
                error = "response exceeds 40MB limit"
            else:
                digest = f"0x{hashlib.sha256(resp.content).hexdigest().lower()}"
                if digest == expected_sha256:
                    ok = True
                else:
                    error = f"sha256 mismatch: expected {expected_sha256}, got {digest}"
        else:
            # Create appropriate client based on onion or clearnet
            proxy = None
            if is_onion_url(url):
                proxy = os.environ.get("TOR_SOCKS_PROXY", DEFAULT_TOR_PROXY)

            with httpx.Client(proxy=proxy, timeout=DEFAULT_TIMEOUT, follow_redirects=True) as req_client:
                with req_client.stream("GET", url) as resp:
                    if resp.status_code != 200:
                        elapsed_ms = int((time.monotonic() - start_time) * 1000)
                        error = f"HTTP {resp.status_code}"
                    else:
                        hasher = hashlib.sha256()
                        total_bytes = 0
                        size_exceeded = False
                        for chunk in resp.iter_bytes():
                            total_bytes += len(chunk)
                            if total_bytes > MAX_RESPONSE_SIZE:
                                size_exceeded = True
                                break
                            hasher.update(chunk)

                        elapsed_ms = int((time.monotonic() - start_time) * 1000)
                        if size_exceeded:
                            error = "response exceeds 40MB limit"
                        else:
                            digest = f"0x{hasher.hexdigest().lower()}"
                            if digest == expected_sha256:
                                ok = True
                            else:
                                error = f"sha256 mismatch: expected {expected_sha256}, got {digest}"
    except httpx.TimeoutException:
        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        error = "timeout"
    except Exception as exc:
        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        error = str(exc)

    return {
        "operator": operator_address,
        "cid": cid,
        "ok": ok,
        "ms": elapsed_ms,
        "error": error,
        "at": datetime.now(timezone.utc).isoformat(),
    }


def run_probe(
    targets_path: Path,
    state_dir: Path,
    client: Optional[httpx.Client] = None,
    seed: Optional[int] = None,
) -> list[dict[str, Any]]:
    targets_data = json.loads(targets_path.read_text(encoding="utf-8"))
    state_dir.mkdir(parents=True, exist_ok=True)

    # Persist latest targets so report generator has current operator & gateway metadata
    (state_dir / "targets.json").write_text(json.dumps(targets_data, indent=2), encoding="utf-8")

    operators: list[dict[str, Any]] = targets_data.get("operators", [])
    probes: list[dict[str, Any]] = targets_data.get("probes", [])

    if seed is not None:
        random.seed(seed)

    checks_file = state_dir / "checks.jsonl"
    all_results: list[dict[str, Any]] = []

    own_client = client is None
    clearnet_client = client or httpx.Client(timeout=DEFAULT_TIMEOUT, follow_redirects=True)
    onion_client: Optional[httpx.Client] = None

    try:
        for op in operators:
            op_addr = op["address"]
            gateway = op["gateway"]

            if not probes:
                continue

            # Choose 3 probes per sync round
            if len(probes) >= 3:
                selected_probes = random.sample(probes, 3)
            else:
                # Repeat to reach 3 probes if fewer are available
                selected_probes = [random.choice(probes) for _ in range(3)]

            for pr in selected_probes:
                is_onion = is_onion_url(gateway)
                if is_onion:
                    if onion_client is None:
                        proxy = os.environ.get("TOR_SOCKS_PROXY", DEFAULT_TOR_PROXY)
                        onion_client = httpx.Client(proxy=proxy, timeout=DEFAULT_TIMEOUT, follow_redirects=True)
                    req_client = onion_client
                else:
                    req_client = clearnet_client

                result = probe_single(op_addr, gateway, pr, client=req_client)
                all_results.append(result)
                with checks_file.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(result) + "\n")
    finally:
        if own_client:
            clearnet_client.close()
        if onion_client is not None:
            onion_client.close()

    return all_results
