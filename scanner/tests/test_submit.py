"""SubmitService: scan, pin, relay, store (A3 task T2, I5 /api/submit)."""

import hashlib
import json

import jsonschema
import pytest

from fixtures import make_fixtures as mf
from scanner.checks import MAX_PDF_BYTES, NearDupIndex
from scanner.pinning import PinError
from scanner.relay import DuplicateBook, RelayError
from scanner.submit import SubmitService

GOOD = mf.ROOT / "pdfs" / "good.pdf"
BOOK_SCHEMA = json.loads((mf.ROOT.parent / "schemas" / "book.schema.json").read_text(encoding="utf-8"))
REJECT = mf.build_reject_set(mf.ROOT / "out" / "test-submit-reject")
REVIEW = mf.build_review_set(mf.ROOT / "out" / "test-submit-review")
TX = "0x" + "ab" * 32


class FakePinner:
    def __init__(self, error=None):
        self.calls = []
        self.error = error

    def pin(self, data: bytes, filename: str) -> str:
        if self.error:
            raise self.error
        self.calls.append((filename, data))
        return mf.cid_v1_raw(hashlib.sha256(data).digest())


class FakeRelay:
    def __init__(self, result=(1, TX), error=None):
        self.calls = []
        self.result = result
        self.error = error

    def relay(self, pdf_cid, meta_cid, sha256):
        self.calls.append((pdf_cid, meta_cid, sha256))
        if self.error:
            raise self.error
        return self.result


def _service(tmp_path, **kw):
    pinner = kw.pop("pinner", FakePinner())
    relay = kw.pop("relay", FakeRelay())
    return SubmitService(pinner=pinner, relay=relay, data_dir=tmp_path, **kw), pinner, relay


def _submit(service, pdf_bytes, meta, via="web"):
    return service.submit(pdf_bytes, meta, via=via, sha256=mf.sha256_hex(pdf_bytes), total_size=len(pdf_bytes))


def test_reject_stores_nothing(tmp_path):
    service, pinner, relay = _service(tmp_path)
    case = REJECT["js_openaction"]
    res = _submit(service, case.pdf.read_bytes(), case.meta)
    assert res.status == 422
    assert res.body["report"]["verdict"] == "reject"
    assert res.body["bookId"] is None and res.body["pdfCid"] is None and res.body["metaCid"] is None
    assert pinner.calls == [] and relay.calls == []
    assert not any(tmp_path.rglob("*.json"))


def test_pass_pins_report_pdf_meta_in_order(tmp_path):
    service, pinner, relay = _service(tmp_path)
    data = GOOD.read_bytes()
    res = _submit(service, data, mf._good_input())
    assert res.status == 200, res.body
    assert [name for name, _ in pinner.calls] == ["report.json", "book.pdf", "meta.json"]
    report_cid = mf.cid_v1_raw(hashlib.sha256(pinner.calls[0][1]).digest())
    pdf_cid = mf.cid_v1_raw(hashlib.sha256(pinner.calls[1][1]).digest())
    meta_cid = mf.cid_v1_raw(hashlib.sha256(pinner.calls[2][1]).digest())
    meta = json.loads(pinner.calls[2][1])
    assert meta["scanReportCid"] == report_cid
    assert meta["pdf"] == {"cid": pdf_cid, "sha256": mf.sha256_hex(data), "bytes": len(data), "pages": 12}
    assert meta["submittedVia"] == "web" and meta["schemaVersion"] == "1.0.0"
    assert relay.calls == [(pdf_cid, meta_cid, mf.sha256_hex(data))]
    assert res.body == {"report": res.body["report"], "bookId": 1, "txHash": TX, "pdfCid": pdf_cid, "metaCid": meta_cid}
    assert pinner.calls[1][1] == data


def test_pinned_meta_validates_full_book_schema(tmp_path):
    service, pinner, _ = _service(tmp_path)
    _submit(service, GOOD.read_bytes(), mf._good_input(), via="ubot")
    meta = json.loads(pinner.calls[2][1])
    jsonschema.validate(meta, BOOK_SCHEMA)
    assert meta["submittedVia"] == "ubot"


def test_review_verdict_is_still_submitted(tmp_path):
    service, pinner, relay = _service(tmp_path)
    case = REVIEW["spam_urls"]
    res = _submit(service, case.pdf.read_bytes(), case.meta)
    assert res.status == 200 and res.body["report"]["verdict"] == "review"
    assert len(pinner.calls) == 3 and len(relay.calls) == 1


def test_duplicate_returns_409_existing_id(tmp_path):
    service, pinner, relay = _service(tmp_path, lookup_id=lambda sha: 7)
    res = _submit(service, GOOD.read_bytes(), mf._good_input())
    assert res.status == 409 and res.body == {"code": "DUPLICATE", "existingId": 7}
    assert pinner.calls == [] and relay.calls == []


def test_relayer_duplicate_maps_to_409(tmp_path):
    service, _, _ = _service(tmp_path, relay=FakeRelay(error=DuplicateBook(9)))
    res = _submit(service, GOOD.read_bytes(), mf._good_input())
    assert res.status == 409 and res.body == {"code": "DUPLICATE", "existingId": 9}


def test_relay_failure_returns_502_and_keeps_report(tmp_path):
    service, pinner, _ = _service(tmp_path, relay=FakeRelay(error=RelayError("CHAIN_ERROR", "reverted")))
    data = GOOD.read_bytes()
    res = _submit(service, data, mf._good_input())
    assert res.status == 502 and res.body["code"] == "RELAY_ERROR" and "CHAIN_ERROR" in res.body["detail"]
    assert len(pinner.calls) == 3
    assert (tmp_path / "reports" / f"{mf.sha256_hex(data)}.json").is_file()


def test_pin_failure_returns_502(tmp_path):
    service, _, relay = _service(tmp_path, pinner=FakePinner(error=PinError("kubo down")))
    res = _submit(service, GOOD.read_bytes(), mf._good_input())
    assert res.status == 502 and res.body["code"] == "PIN_ERROR"
    assert relay.calls == []


def test_too_large_is_413(tmp_path):
    service, pinner, _ = _service(tmp_path)
    data = GOOD.read_bytes()
    res = service.submit(data, mf._good_input(), via="web", sha256=mf.sha256_hex(data), total_size=MAX_PDF_BYTES + 1)
    assert res.status == 413 and res.body["code"] == "TOO_LARGE"
    assert pinner.calls == []


def test_bad_via_is_400(tmp_path):
    service, _, _ = _service(tmp_path)
    res = _submit(service, GOOD.read_bytes(), mf._good_input(), via="direct")
    assert res.status == 400 and res.body["code"] == "INVALID_INPUT"


def test_report_is_stored_for_api_report(tmp_path):
    service, _, _ = _service(tmp_path)
    data = GOOD.read_bytes()
    res = _submit(service, data, mf._good_input())
    stored = json.loads((tmp_path / "reports" / f"{mf.sha256_hex(data)}.json").read_text(encoding="utf-8"))
    assert stored == res.body["report"]


def test_submit_indexes_text_for_near_duplicates(tmp_path):
    index = NearDupIndex()
    service, _, _ = _service(tmp_path, near_dup=index)
    _submit(service, GOOD.read_bytes(), mf._good_input())
    assert len(index) == 1
    assert (tmp_path / "minhash.pkl").is_file()


@pytest.mark.parametrize("bad_meta", ["not a dict", None])
def test_non_object_meta_is_rejected_not_crashing(tmp_path, bad_meta):
    service, pinner, _ = _service(tmp_path)
    res = _submit(service, GOOD.read_bytes(), bad_meta)
    assert res.status == 422 and pinner.calls == []


def test_allow_reuploads_stamps_pdf_and_succeeds(tmp_path):
    orig = GOOD.read_bytes()
    orig_sha = mf.sha256_hex(orig)
    service, pinner, relay = _service(tmp_path, lookup_id=lambda sha: 7 if sha == orig_sha else 0, allow_reuploads=True)
    res = _submit(service, orig, mf._good_input())
    assert res.status == 200
    assert res.body["bookId"] == 1
    assert len(pinner.calls) == 3 and len(relay.calls) == 1
    pinned_pdf = pinner.calls[1][1]
    assert pinned_pdf != orig and pinned_pdf.startswith(orig)
    assert b"% alexandria-reupload-" in pinned_pdf


def test_allow_reuploads_disabled_returns_409(tmp_path):
    orig = GOOD.read_bytes()
    orig_sha = mf.sha256_hex(orig)
    service, pinner, relay = _service(tmp_path, lookup_id=lambda sha: 7 if sha == orig_sha else 0, allow_reuploads=False)
    res = _submit(service, orig, mf._good_input())
    assert res.status == 409 and res.body == {"code": "DUPLICATE", "existingId": 7}
    assert pinner.calls == [] and relay.calls == []

