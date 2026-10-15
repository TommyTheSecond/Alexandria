"""Tests for fixtures/make_fixtures.py (A3 task T0)."""

import hashlib
import json
from pathlib import Path

import pymupdf
import pikepdf
import pytest

from fixtures import make_fixtures as mf

REPO = Path(__file__).resolve().parents[2]
FIXTURES = REPO / "fixtures"
SCHEMA = REPO / "schemas" / "book.schema.json"
MAX_PDF_BYTES = 31_457_280


def _load_catalog():
    return json.loads((FIXTURES / "catalog.json").read_text(encoding="utf-8"))


def test_cid_v1_raw_matches_known_empty_vector():
    assert mf.cid_v1_raw(b"") == "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku"


def test_cid_v1_raw_refuses_data_larger_than_one_block():
    with pytest.raises(ValueError):
        mf.cid_v1_raw(b"x" * (mf.MAX_SINGLE_BLOCK + 1))


def test_sha256_hex_format():
    assert mf.sha256_hex(b"") == "0x" + hashlib.sha256(b"").hexdigest()


def test_text_pdf_build_is_deterministic(tmp_path):
    a, b = tmp_path / "a.pdf", tmp_path / "b.pdf"
    for p in (a, b):
        mf.build_text_pdf(p, title="Fixture Book", author="Ada Fixture", pages=12, words=2500, seed=1)
    assert a.read_bytes() == b.read_bytes()


def test_good_pdf_has_twelve_pages_title_author_and_enough_words():
    with pymupdf.open(FIXTURES / "pdfs" / "good.pdf") as doc:
        assert doc.page_count == 12
        first = doc[0].get_text()
        words = sum(len(page.get_text().split()) for page in doc)
    assert "Fixture Book" in first
    assert "Ada Fixture" in first
    assert words >= 2500


def test_committed_fixtures_match_generator(tmp_path):
    mf.build_committed(tmp_path)
    for rel in ("pdfs/good.pdf", "pdfs/good-2.pdf", "pdfs/good-3.pdf", "catalog.json",
                "meta/good.json", "meta/good-2.json", "meta/good-3.json", "ipfs-index.json"):
        assert (tmp_path / rel).read_bytes() == (FIXTURES / rel).read_bytes(), rel


def test_catalog_hashes_cids_and_sizes_match_pdfs():
    index = json.loads((FIXTURES / "ipfs-index.json").read_text(encoding="utf-8"))
    for book in _load_catalog()["books"]:
        data = (FIXTURES / index[book["pdfCid"]]).read_bytes()
        assert book["pdfSha256"] == mf.sha256_hex(data)
        assert book["pdfCid"] == mf.cid_v1_raw(data)
        assert book["meta"]["pdf"] == {
            "cid": book["pdfCid"],
            "sha256": book["pdfSha256"],
            "bytes": len(data),
            "pages": pymupdf.open(stream=data, filetype="pdf").page_count,
        }
        meta_bytes = (FIXTURES / index[book["metaCid"]]).read_bytes()
        assert book["metaCid"] == mf.cid_v1_raw(meta_bytes)
        assert json.loads(meta_bytes) == book["meta"]


def test_catalog_pdfs_are_distinct():
    hashes = [b["pdfSha256"] for b in _load_catalog()["books"]]
    assert len(set(hashes)) == len(hashes) == 3


def test_catalog_shape_and_statuses():
    cat = _load_catalog()
    assert cat["network"] == "fuji" and cat["chainId"] == 43113 and cat["source"] == "snapshot"
    assert [b["id"] for b in cat["books"]] == [1, 2, 3]
    assert [b["status"] for b in cat["books"]] == ["approved", "flagged", "approved"]


def test_catalog_has_cjk_title_and_cyrillic_author():
    book = _load_catalog()["books"][2]["meta"]
    assert any("一" <= ch <= "鿿" for ch in book["title"])
    assert any("Ѐ" <= ch <= "ӿ" for ch in book["authors"][0]["name"])


def test_catalog_meta_validates_against_book_schema():
    if not SCHEMA.exists():
        pytest.skip("schemas/ lands with the G0 interface PR (#3)")
    import jsonschema

    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    for book in _load_catalog()["books"]:
        jsonschema.validate(book["meta"], schema)


def test_meta_inputs_omit_fields_the_scanner_fills():
    for name in ("good.json", "good-2.json", "good-3.json"):
        meta = json.loads((FIXTURES / "meta" / name).read_text(encoding="utf-8"))
        assert not {"schemaVersion", "pdf", "submittedVia", "scanReportCid"} & meta.keys(), name


def test_reject_set_has_at_least_ten_cases(tmp_path):
    cases = mf.build_reject_set(tmp_path)
    assert len(cases) >= 10
    for case in cases.values():
        assert case.pdf.exists()
        assert case.expect == "reject"
        assert case.check


def test_review_set_cases(tmp_path):
    cases = mf.build_review_set(tmp_path)
    assert set(cases) == {"spam_urls", "spam_keywords", "spam_repeat", "no_text"}
    assert all(c.expect == "review" for c in cases.values())


def test_js_object_stream_fixture_hides_javascript_from_raw_bytes(tmp_path):
    case = mf.build_reject_set(tmp_path)["js_object_stream"]
    raw = case.pdf.read_bytes()
    assert b"/JavaScript" not in raw and b"/JS" not in raw
    with pikepdf.open(case.pdf) as pdf:
        found = any(isinstance(o, pikepdf.Dictionary) and "/JS" in o for o in pdf.objects)
    assert found


def test_js_incremental_update_fixture_has_two_revisions(tmp_path):
    case = mf.build_reject_set(tmp_path)["js_incremental_update"]
    raw = case.pdf.read_bytes()
    assert raw.count(b"%%EOF") >= 2
    with pikepdf.open(case.pdf) as pdf:
        assert pdf.Root.OpenAction.S == pikepdf.Name.JavaScript


def test_too_large_fixture_is_one_byte_over_limit(tmp_path):
    case = mf.build_reject_set(tmp_path)["too_large"]
    assert case.pdf.stat().st_size == MAX_PDF_BYTES + 1
    assert case.pdf.read_bytes()[:5] == b"%PDF-"


def test_eicar_string_is_not_stored_whole_in_source():
    source = Path(mf.__file__).read_text(encoding="utf-8")
    assert "EICAR-STANDARD-ANTIVIRUS-TEST-FILE" not in source
