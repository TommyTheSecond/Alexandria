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


class FakeService:
    def __init__(self):
        self.calls = []

    def submit(self, pdf, meta, *, via, sha256, total_size):
        from scanner.submit import SubmitResponse

        self.calls.append({"via": via, "sha256": sha256, "total_size": total_size, "meta": meta})
        return SubmitResponse(201 if via == "ubot" else 200, {"ok": True})


def _post_submit(client, via=None, headers=None):
    data = {"meta": json.dumps(mf._good_input())}
    if via:
        data["via"] = via
    return client.post("/api/submit", files={"pdf": ("good.pdf", GOOD.read_bytes(), "application/pdf")},
                       data=data, headers=headers or {})


def test_submit_not_configured_is_503(tmp_path):
    r = _post_submit(TestClient(create_app(data_dir=tmp_path, submit_service=None)))
    assert r.status_code == 503 and r.json()["code"] == "NOT_CONFIGURED"


def test_submit_passes_via_and_hash_to_service(tmp_path):
    service = FakeService()
    client = TestClient(create_app(data_dir=tmp_path, submit_service=service))
    r = _post_submit(client, via="ubot")
    assert r.status_code == 201
    assert service.calls[0]["via"] == "ubot"
    assert service.calls[0]["sha256"] == mf.sha256_hex(GOOD.read_bytes())
    assert service.calls[0]["total_size"] == len(GOOD.read_bytes())


def test_submit_defaults_via_web(tmp_path):
    service = FakeService()
    _post_submit(TestClient(create_app(data_dir=tmp_path, submit_service=service)))
    assert service.calls[0]["via"] == "web"


def test_submit_rate_limit_429_after_5(tmp_path):
    client = TestClient(create_app(data_dir=tmp_path, submit_service=FakeService()))
    statuses = [_post_submit(client).status_code for _ in range(6)]
    assert statuses[:5] == [200] * 5
    last = _post_submit(client)
    assert last.status_code == 429 and last.json()["code"] == "RATE_LIMIT" and last.json()["retryAfterSec"] > 0


def test_cors_allows_any_origin_without_credentials(tmp_path):
    r = _client(tmp_path).get("/api/health", headers={"Origin": "https://tommythesecond.github.io"})
    assert r.headers["access-control-allow-origin"] == "*"
    assert "access-control-allow-credentials" not in r.headers


class FixedService:
    def __init__(self, status):
        self.status = status

    def submit(self, pdf, meta, *, via, sha256, total_size):
        from scanner.submit import SubmitResponse

        return SubmitResponse(self.status, {"code": "X"})


def test_submit_answers_4xx_do_not_use_the_quota(tmp_path):
    for status in (400, 409, 413, 422):
        client = TestClient(create_app(data_dir=tmp_path, submit_service=FixedService(status)))
        assert [_post_submit(client).status_code for _ in range(6)] == [status] * 6


def test_submit_relay_errors_use_the_quota(tmp_path):
    client = TestClient(create_app(data_dir=tmp_path, submit_service=FixedService(502)))
    assert [_post_submit(client).status_code for _ in range(6)] == [502] * 5 + [429]


def test_submit_bad_form_does_not_use_the_quota(tmp_path):
    client = TestClient(create_app(data_dir=tmp_path, submit_service=FakeService()))
    for _ in range(6):
        r = client.post("/api/submit", files={"pdf": ("good.pdf", GOOD.read_bytes(), "application/pdf")},
                        data={"meta": "{not json"})
        assert r.status_code == 400
    assert _post_submit(client).status_code == 200


def test_submit_hourly_limit_from_env(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOADS_PER_HOUR", "20")
    client = TestClient(create_app(data_dir=tmp_path, submit_service=FakeService()))
    assert [_post_submit(client).status_code for _ in range(21)] == [200] * 20 + [429]


def test_submit_daily_limit_from_env(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOADS_PER_HOUR", "50")
    monkeypatch.setenv("UPLOADS_PER_DAY", "7")
    client = TestClient(create_app(data_dir=tmp_path, submit_service=FakeService()))
    assert [_post_submit(client).status_code for _ in range(8)] == [200] * 7 + [429]
