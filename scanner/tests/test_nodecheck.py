"""Tests for node checker probe, report, and duplicate detection."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from scanner.nodecheck.probe import probe_single, run_probe, is_onion_url
from scanner.nodecheck.report import run_report

GOOD_CONTENT = b"%PDF-1.4 test file content for nodecheck"
GOOD_SHA = "0x" + hashlib.sha256(GOOD_CONTENT).hexdigest()
WRONG_CONTENT = b"corrupted bytes or wrong file"
HTML_200_CONTENT = b"<html><body>404 Not Found but returned 200 OK</body></html>"

PROBE_BOOK = {
    "cid": "bafybeigoodbook123",
    "sha256": GOOD_SHA,
    "kind": "book",
    "bookId": 1,
}


def test_is_onion_url():
    assert is_onion_url("http://zm3fkcrtlaclnxw2u5xjjpauwp3ngchkhu3ji26xrvejf46mglvrkqad.onion")
    assert is_onion_url("http://test.onion/ipfs/bafy123")
    assert not is_onion_url("https://gateway.example.com/ipfs/bafy123")
    assert not is_onion_url("http://127.0.0.1:8080")


def test_probe_good_node():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == f"/ipfs/{PROBE_BOOK['cid']}"
        return httpx.Response(200, content=GOOD_CONTENT)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    result = probe_single("0x1111111111111111111111111111111111111111", "https://good.node.org", PROBE_BOOK, client=client)

    assert result["ok"] is True
    assert result["error"] is None
    assert result["cid"] == PROBE_BOOK["cid"]


def test_probe_wrong_bytes():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=WRONG_CONTENT)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    result = probe_single("0x2222222222222222222222222222222222222222", "https://badbytes.node.org", PROBE_BOOK, client=client)

    assert result["ok"] is False
    assert "sha256 mismatch" in result["error"]


def test_probe_timeout():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("Connection timed out")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    result = probe_single("0x3333333333333333333333333333333333333333", "https://timeout.node.org", PROBE_BOOK, client=client)

    assert result["ok"] is False
    assert result["error"] == "timeout"


def test_probe_html_200():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"Content-Type": "text/html"}, content=HTML_200_CONTENT)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    result = probe_single("0x4444444444444444444444444444444444444444", "https://html.node.org", PROBE_BOOK, client=client)

    assert result["ok"] is False
    assert "sha256 mismatch" in result["error"]


def test_nodecheck_full_matrix_only_good_node_active(tmp_path: Path):
    """
    Test suite per D2-1 spec:
    - a good node;
    - one returning wrong bytes;
    - one timing out;
    - one returning HTML 200;
    - a duplicate hostname;
    - an onion URL using the SOCKS proxy (mocked).
    Only the good node (and onion node if good) ends up active.
    Here we test:
    - op_good: passes 3/3 -> active
    - op_wrong: 0/3 -> inactive
    - op_timeout: 0/3 -> inactive
    - op_html: 0/3 -> inactive
    - op_dup_host: duplicate of op_good -> inactive (duplicateOf = op_good)
    - op_dup_ip: duplicate IP of op_wrong -> inactive (duplicateOf = op_wrong)
    Result: Only op_good is active!
    """
    op_good = "0x1111111111111111111111111111111111111111"
    op_wrong = "0x2222222222222222222222222222222222222222"
    op_timeout = "0x3333333333333333333333333333333333333333"
    op_html = "0x4444444444444444444444444444444444444444"
    op_dup_host = "0x5555555555555555555555555555555555555555"
    op_dup_ip = "0x6666666666666666666666666666666666666666"

    targets = {
        "epoch": 1,
        "generatedAt": "2026-10-16T01:00:00Z",
        "operators": [
            {"address": op_good, "gateway": "https://good-node.example.org"},
            {"address": op_wrong, "gateway": "https://wrong-bytes.example.org"},
            {"address": op_timeout, "gateway": "https://timeout-node.example.org"},
            {"address": op_html, "gateway": "https://html-node.example.org"},
            {"address": op_dup_host, "gateway": "https://good-node.example.org:8443"},
            {"address": op_dup_ip, "gateway": "https://another-wrong.example.org"},
        ],
        "probes": [PROBE_BOOK],
    }

    targets_file = tmp_path / "targets.json"
    targets_file.write_text(json.dumps(targets), encoding="utf-8")
    state_dir = tmp_path / "state"

    def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        if "good-node" in host:
            return httpx.Response(200, content=GOOD_CONTENT)
        elif "wrong-bytes" in host:
            return httpx.Response(200, content=WRONG_CONTENT)
        elif "timeout-node" in host:
            raise httpx.ReadTimeout("Gateway timeout")
        elif "html-node" in host:
            return httpx.Response(200, headers={"Content-Type": "text/html"}, content=HTML_200_CONTENT)
        elif "another-wrong" in host:
            return httpx.Response(200, content=WRONG_CONTENT)
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))

    # Run probe
    results = run_probe(targets_file, state_dir, client=client, seed=42)
    assert len(results) == 18  # 6 operators * 3 probes

    # Custom IP resolver for testing duplicate IP
    def fake_resolver(hostname: str) -> str | None:
        if hostname in ("wrong-bytes.example.org", "another-wrong.example.org"):
            return "192.0.2.100"  # Shared IP for wrong and another-wrong
        return None

    # Run report
    report_out = tmp_path / "report.json"
    report_data = run_report(state_dir, epoch=1, out_path=report_out, ip_resolver=fake_resolver)

    # Validate output
    assert report_data["epoch"] == 1
    assert report_data["schemaVersion"] == "1.0.0"

    # Verify active list: only op_good
    assert report_data["active"] == [op_good]

    # Verify duplicate annotations
    op_map = {o["address"]: o for o in report_data["operators"]}
    assert op_map[op_good]["active"] is True
    assert op_map[op_good]["duplicateOf"] is None

    assert op_map[op_wrong]["active"] is False
    assert op_map[op_wrong]["duplicateOf"] is None

    assert op_map[op_timeout]["active"] is False
    assert op_map[op_timeout]["duplicateOf"] is None

    assert op_map[op_html]["active"] is False
    assert op_map[op_html]["duplicateOf"] is None

    # op_dup_host shares hostname with op_good
    assert op_map[op_dup_host]["active"] is False
    assert op_map[op_dup_host]["duplicateOf"] == op_good

    # op_dup_ip shares IP with op_wrong
    assert op_map[op_dup_ip]["active"] is False
    assert op_map[op_dup_ip]["duplicateOf"] == op_wrong
