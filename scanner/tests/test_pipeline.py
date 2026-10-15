"""End-to-end scan tests over the fixture sets (A3 task T1)."""

import json

import jsonschema
import pytest

from fixtures import make_fixtures as mf
from scanner.pipeline import scan

REPORT_SCHEMA = json.loads((mf.ROOT.parent / "schemas" / "scan-report.schema.json").read_text(encoding="utf-8"))
REJECT = mf.build_reject_set(mf.ROOT / "out" / "test-reject")
REVIEW = mf.build_review_set(mf.ROOT / "out" / "test-review")


def _failed(report):
    return {c["id"] for c in report["checks"] if not c["passed"]}


def test_good_fixture_passes():
    report = scan(mf.ROOT.joinpath("pdfs", "good.pdf").read_bytes(), mf._good_input())
    assert report["verdict"] == "pass", _failed(report)
    assert report["score"] == 100


@pytest.mark.parametrize("name", sorted(REJECT))
def test_every_reject_fixture_is_rejected(name):
    case = REJECT[name]
    report = scan(case.pdf.read_bytes(), case.meta)
    assert report["verdict"] == "reject"
    assert case.check in _failed(report)


@pytest.mark.parametrize("name", sorted(REVIEW))
def test_review_fixtures_get_review(name):
    case = REVIEW[name]
    report = scan(case.pdf.read_bytes(), case.meta)
    assert report["verdict"] == "review", _failed(report)
    assert case.check in _failed(report)


def test_report_matches_schema():
    report = scan(mf.ROOT.joinpath("pdfs", "good.pdf").read_bytes(), mf._good_input())
    jsonschema.validate(report, REPORT_SCHEMA)
    assert report["pdfSha256"] == mf.sha256_hex(mf.ROOT.joinpath("pdfs", "good.pdf").read_bytes())


def test_reject_report_matches_schema():
    case = REJECT["notpdf"]
    jsonschema.validate(scan(case.pdf.read_bytes(), case.meta), REPORT_SCHEMA)


def test_parser_timeout_rejects():
    report = scan(mf.ROOT.joinpath("pdfs", "good.pdf").read_bytes(), mf._good_input(), timeout=0.001)
    assert report["verdict"] == "reject"
    parse = next(c for c in report["checks"] if c["id"] == "pdf.parse")
    assert not parse["passed"] and "timed out" in parse["detail"]


def test_non_pdf_skips_parser_checks():
    case = REJECT["notpdf"]
    ids = {c["id"] for c in scan(case.pdf.read_bytes(), case.meta)["checks"]}
    assert "pdf.magic" in ids and "pdf.active" not in ids and "meta.schema" in ids
