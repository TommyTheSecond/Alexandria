"""ingest/submit_batch.py: send a folder of books through /api/submit (A3 task T3)."""

import json

import httpx

from fixtures import make_fixtures as mf
from ingest.submit_batch import format_table, main, submit_folder

API = "http://127.0.0.1:8000/api"


def _book(folder, name, title="Fixture Book"):
    (folder / f"{name}.pdf").write_bytes(mf.ROOT.joinpath("pdfs", "good.pdf").read_bytes())
    meta = mf._good_input()
    meta["title"] = title
    (folder / f"{name}.json").write_text(json.dumps(meta), encoding="utf-8")


def _report(verdict, failed=()):
    return {"verdict": verdict, "score": 100 - 15 * len(failed),
            "checks": [{"id": c, "passed": False, "severity": "review", "detail": "x"} for c in failed]}


def _client(handler, seen=None):
    def wrapped(request):
        if seen is not None:
            seen.append(request)
        return handler(request)
    return httpx.Client(transport=httpx.MockTransport(wrapped))


def test_submit_batch_reports_each_result(tmp_path):
    _book(tmp_path, "a-book", "Alpha")
    _book(tmp_path, "b-book", "Beta")
    replies = iter([
        httpx.Response(200, json={"report": _report("pass"), "bookId": 4, "txHash": "0x" + "1" * 64,
                                  "pdfCid": "bafkreia", "metaCid": "bafkreib"}),
        httpx.Response(422, json={"report": _report("reject", ["pd.rule"]), "bookId": None, "txHash": None,
                                  "pdfCid": None, "metaCid": None}),
    ])
    rows = submit_folder(tmp_path, client=_client(lambda r: next(replies)), api=API)
    assert [(r.name, r.status, r.verdict, r.book_id) for r in rows] == [
        ("a-book", 200, "pass", 4), ("b-book", 422, "reject", None)]
    assert rows[1].problems == "pd.rule"
    table = format_table(rows)
    assert "Alpha" in table and "Beta" in table and "reject" in table


def test_sends_pdf_meta_and_via_ubot(tmp_path):
    _book(tmp_path, "a-book")
    seen = []
    submit_folder(tmp_path, client=_client(lambda r: httpx.Response(200, json={
        "report": _report("pass"), "bookId": 1, "txHash": "0x", "pdfCid": "x", "metaCid": "y"}), seen), api=API)
    request = seen[0]
    body = request.read()
    assert str(request.url) == f"{API}/submit"
    assert b'name="via"' in body and b"ubot" in body
    assert b'name="meta"' in body and b"Fixture Book" in body
    assert b"%PDF-" in body


def test_dry_run_uses_scan_endpoint(tmp_path):
    _book(tmp_path, "a-book")
    seen = []
    rows = submit_folder(tmp_path, client=_client(lambda r: httpx.Response(200, json=_report("review", ["text.match"])),
                                                  seen), api=API, dry_run=True)
    assert str(seen[0].url) == f"{API}/scan"
    assert rows[0].verdict == "review" and rows[0].problems == "text.match"


def test_missing_meta_is_reported_not_sent(tmp_path):
    (tmp_path / "lonely.pdf").write_bytes(b"%PDF-1.7")
    seen = []
    rows = submit_folder(tmp_path, client=_client(lambda r: httpx.Response(500), seen), api=API)
    assert seen == []
    assert rows[0].name == "lonely" and rows[0].status is None and "lonely.json" in rows[0].problems


def test_stops_on_rate_limit(tmp_path):
    for name in ("a", "b", "c"):
        _book(tmp_path, name)
    seen = []
    rows = submit_folder(tmp_path, client=_client(
        lambda r: httpx.Response(429, json={"code": "RATE_LIMIT", "retryAfterSec": 120}), seen), api=API)
    assert len(seen) == 1
    assert rows[0].status == 429 and "120" in rows[0].problems
    assert [r.status for r in rows[1:]] == [None, None]
    assert all("not sent" in r.problems for r in rows[1:])


def test_error_bodies_are_shown(tmp_path):
    _book(tmp_path, "a")
    rows = submit_folder(tmp_path, client=_client(
        lambda r: httpx.Response(409, json={"code": "DUPLICATE", "existingId": 3})), api=API)
    assert rows[0].status == 409 and "DUPLICATE" in rows[0].problems and "3" in rows[0].problems


def test_unreachable_api(tmp_path):
    _book(tmp_path, "a")

    def handler(request):
        raise httpx.ConnectError("refused")

    rows = submit_folder(tmp_path, client=_client(handler), api=API)
    assert rows[0].status is None and "unreachable" in rows[0].problems.lower()


def test_main_exit_code_and_results_file(tmp_path, monkeypatch, capsys):
    _book(tmp_path, "a")
    _book(tmp_path, "b")
    replies = iter([httpx.Response(200, json={"report": _report("pass"), "bookId": 1, "txHash": "0x",
                                              "pdfCid": "x", "metaCid": "y"}),
                    httpx.Response(422, json={"report": _report("reject", ["pdf.active"]), "bookId": None,
                                              "txHash": None, "pdfCid": None, "metaCid": None})])
    monkeypatch.setattr("ingest.submit_batch.make_client", lambda: _client(lambda r: next(replies)))
    assert main([str(tmp_path), "--api", API]) == 1
    results = json.loads((tmp_path / "submit-results.json").read_text(encoding="utf-8"))
    assert [r["status"] for r in results] == [200, 422]
    assert "pdf.active" in capsys.readouterr().out


def test_reupload_retries_on_409_when_enabled(tmp_path):
    _book(tmp_path, "a-book")
    seen = []
    replies = iter([
        httpx.Response(409, json={"code": "DUPLICATE", "existingId": 3}),
        httpx.Response(200, json={"report": _report("pass"), "bookId": 10, "txHash": "0x" + "2" * 64,
                                  "pdfCid": "bafkreic", "metaCid": "bafkreid"}),
    ])
    rows = submit_folder(tmp_path, client=_client(lambda r: next(replies), seen), api=API, allow_reuploads=True)
    assert len(seen) == 2
    assert b"% alexandria-reupload-" in seen[1].read()
    assert rows[0].status == 200 and rows[0].book_id == 10


def test_reupload_disabled_does_not_retry(tmp_path):
    _book(tmp_path, "a-book")
    seen = []
    rows = submit_folder(tmp_path, client=_client(
        lambda r: httpx.Response(409, json={"code": "DUPLICATE", "existingId": 3}), seen), api=API, allow_reuploads=False)
    assert len(seen) == 1
    assert rows[0].status == 409

