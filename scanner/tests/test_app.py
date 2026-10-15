"""HTTP API tests for the I5 scan endpoints (A3 task T1)."""

import json

from fastapi.testclient import TestClient

from fixtures import make_fixtures as mf
from scanner import __version__
from scanner.app import create_app

GOOD = mf.ROOT / "pdfs" / "good.pdf"


def _client(tmp_path):
    return TestClient(create_app(data_dir=tmp_path))


def test_health(tmp_path):
    r = _client(tmp_path).get("/api/health")
    assert r.status_code == 200 and r.json() == {"ok": True, "scannerVersion": __version__}


def test_scan_returns_report(tmp_path):
    r = _client(tmp_path).post("/api/scan", files={"pdf": ("good.pdf", GOOD.read_bytes(), "application/pdf")},
                               data={"meta": json.dumps(mf._good_input())})
    assert r.status_code == 200
    assert r.json()["verdict"] == "pass"


def test_scan_stores_nothing(tmp_path):
    _client(tmp_path).post("/api/scan", files={"pdf": ("good.pdf", GOOD.read_bytes(), "application/pdf")},
                           data={"meta": json.dumps(mf._good_input())})
    assert not any(tmp_path.rglob("*.json"))


def test_scan_bad_meta_json_is_400(tmp_path):
    r = _client(tmp_path).post("/api/scan", files={"pdf": ("good.pdf", GOOD.read_bytes(), "application/pdf")},
                               data={"meta": "{not json"})
    assert r.status_code == 400 and r.json()["code"] == "INVALID_INPUT"


def test_scan_missing_pdf_is_400(tmp_path):
    r = _client(tmp_path).post("/api/scan", data={"meta": json.dumps(mf._good_input())})
    assert r.status_code == 400 and r.json()["code"] == "INVALID_INPUT"


def test_report_404_when_unknown(tmp_path):
    assert _client(tmp_path).get("/api/report/0x" + "a" * 64).status_code == 404


def test_report_rejects_bad_hash_format(tmp_path):
    assert _client(tmp_path).get("/api/report/../../etc").status_code in (400, 404)
    assert _client(tmp_path).get("/api/report/0xZZ").status_code == 400


def test_report_returns_stored_report(tmp_path):
    sha = "0x" + "b" * 64
    (tmp_path / "reports").mkdir()
    (tmp_path / "reports" / f"{sha}.json").write_text(json.dumps({"pdfSha256": sha}), encoding="utf-8")
    r = _client(tmp_path).get(f"/api/report/{sha}")
    assert r.status_code == 200 and r.json()["pdfSha256"] == sha


def test_cors_allows_any_origin_without_credentials(tmp_path):
    r = _client(tmp_path).get("/api/health", headers={"Origin": "https://tommythesecond.github.io"})
    assert r.headers["access-control-allow-origin"] == "*"
    assert "access-control-allow-credentials" not in r.headers
