"""Aggregate probe results, apply active and duplicate rules, and generate epoch report."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import socket
from typing import Any, Callable, Optional
from urllib.parse import urlparse

import jsonschema


def default_ip_resolver(hostname: str) -> Optional[str]:
    if not hostname or hostname.lower().endswith(".onion"):
        return None
    try:
        return socket.gethostbyname(hostname)
    except Exception:
        return None


def run_report(
    state_dir: Path,
    epoch: int,
    out_path: Path,
    schema_path: Optional[Path] = None,
    ip_resolver: Optional[Callable[[str], Optional[str]]] = None,
) -> dict[str, Any]:
    if ip_resolver is None:
        ip_resolver = default_ip_resolver

    # 1. Load operators metadata from state_dir / "targets.json" if available
    targets_file = state_dir / "targets.json"
    operators_metadata: list[dict[str, str]] = []
    if targets_file.exists():
        try:
            targets_data = json.loads(targets_file.read_text(encoding="utf-8"))
            operators_metadata = targets_data.get("operators", [])
        except Exception:
            pass

    # 2. Read checks recorded in checks.jsonl
    checks_file = state_dir / "checks.jsonl"
    all_raw_checks: list[dict[str, Any]] = []
    if checks_file.exists():
        for line in checks_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                try:
                    all_raw_checks.append(json.loads(line))
                except Exception:
                    continue

    # Determine time window: from last report marker or earliest check
    marker_file = state_dir / "last_report_marker.json"
    from_time: Optional[str] = None
    if marker_file.exists():
        try:
            marker = json.loads(marker_file.read_text(encoding="utf-8"))
            from_time = marker.get("to")
        except Exception:
            pass

    to_time = datetime.now(timezone.utc).isoformat()

    # Filter checks within the epoch window
    epoch_checks: list[dict[str, Any]] = []
    for check in all_raw_checks:
        at_time = check.get("at", "")
        if from_time is not None:
            if at_time > from_time:
                epoch_checks.append(check)
        else:
            epoch_checks.append(check)

    if from_time is None:
        from_time = epoch_checks[0]["at"] if epoch_checks else to_time

    # Collect distinct operators: starting with operators_metadata, and supplementing from checks if needed
    seen_addrs = set()
    ordered_ops: list[dict[str, str]] = []
    for op in operators_metadata:
        addr = op["address"]
        if addr not in seen_addrs:
            seen_addrs.add(addr)
            ordered_ops.append(op)

    # If checks contain operators not in metadata (e.g. metadata absent)
    for check in epoch_checks:
        addr = check["operator"]
        if addr not in seen_addrs:
            seen_addrs.add(addr)
            ordered_ops.append({"address": addr, "gateway": ""})

    # Group checks by operator
    checks_by_op: dict[str, list[dict[str, Any]]] = {op["address"]: [] for op in ordered_ops}
    for check in epoch_checks:
        checks_by_op.setdefault(check["operator"], []).append(check)

    # 3. Duplicate rule:
    # Operators whose gateway hostname or resolved IP matches an earlier-registered operator are inactive
    # duplicateOf = that operator's address
    seen_hostnames: dict[str, str] = {}
    seen_ips: dict[str, str] = {}

    operator_reports: list[dict[str, Any]] = []
    active_operators: list[str] = []

    for op in ordered_ops:
        addr = op["address"]
        gateway = op.get("gateway", "")
        parsed = urlparse(gateway)
        hostname = (parsed.hostname or "").lower()

        resolved_ip = ip_resolver(hostname) if hostname else None

        duplicate_of: Optional[str] = None
        if hostname:
            if hostname in seen_hostnames:
                duplicate_of = seen_hostnames[hostname]
            elif resolved_ip and resolved_ip in seen_ips:
                duplicate_of = seen_ips[resolved_ip]
            else:
                seen_hostnames[hostname] = addr
                if resolved_ip:
                    seen_ips[resolved_ip] = addr

        op_checks = checks_by_op.get(addr, [])
        probes_count = len(op_checks)
        passed_count = sum(1 for c in op_checks if c.get("ok", False))

        # Active rule: >= 3 probes, >= 80% passed, and not a duplicate
        is_active = (
            (probes_count >= 3)
            and (passed_count / probes_count >= 0.8)
            and (duplicate_of is None)
        )

        if is_active:
            active_operators.append(addr)

        operator_reports.append({
            "address": addr,
            "gateway": gateway,
            "probes": probes_count,
            "passed": passed_count,
            "active": is_active,
            "duplicateOf": duplicate_of,
        })

    report_data = {
        "schemaVersion": "1.0.0",
        "epoch": epoch,
        "from": from_time,
        "to": to_time,
        "operators": operator_reports,
        "active": active_operators,
        "checks": epoch_checks,
    }

    # 4. Validate against JSON schema
    if schema_path is None:
        # Search relative to repo root
        repo_root = Path(__file__).resolve().parent.parent.parent
        schema_path = repo_root / "schemas" / "node-report.schema.json"

    if schema_path.exists():
        schema_content = json.loads(schema_path.read_text(encoding="utf-8"))
        jsonschema.validate(instance=report_data, schema=schema_content)

    # 5. Write output JSON
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report_data, indent=2), encoding="utf-8")

    # 6. Save marker
    marker_file.write_text(json.dumps({"to": to_time, "epoch": epoch}, indent=2), encoding="utf-8")

    return report_data
