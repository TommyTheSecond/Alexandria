"""Unit tests for the individual scanner checks (A3 task T1)."""

import time

import pikepdf
import pytest

from fixtures import make_fixtures as mf
from scanner import checks, sandbox
from scanner.verdict import verdict_and_score

GOOD_PDF = mf.ROOT / "pdfs" / "good.pdf"


def _good_meta():
    return mf._good_input()


# --- pdf.magic / pdf.size ----------------------------------------------------

def test_magic_passes_pdf_and_fails_png():
    assert checks.pdf_magic(b"%PDF-1.7 rest").passed
    failed = checks.pdf_magic(b"\x89PNG\r\n")
    assert not failed.passed and failed.severity == "reject" and failed.id == "pdf.magic"


def test_size_limit_is_inclusive():
    assert checks.pdf_size(checks.MAX_PDF_BYTES).passed
    assert not checks.pdf_size(checks.MAX_PDF_BYTES + 1).passed


# --- pdf.parse / pdf.active (run in the sandbox child) -----------------------

def test_parse_passes_good_pdf():
    assert checks.pdf_parse(GOOD_PDF.read_bytes()).passed


def test_parse_fails_encrypted_and_short(tmp_path):
    cases = mf.build_reject_set(tmp_path)
    assert not checks.pdf_parse(cases["encrypted"].pdf.read_bytes()).passed
    short = checks.pdf_parse(cases["five_pages"].pdf.read_bytes())
    assert not short.passed and "5 pages" in short.detail


def test_parse_fails_garbage():
    assert not checks.pdf_parse(b"%PDF-1.7\nthis is not a pdf").passed


def test_active_passes_good_pdf():
    assert checks.pdf_active(GOOD_PDF.read_bytes()).passed


@pytest.mark.parametrize("name", ["js_openaction", "launch_action", "embedded_file",
                                  "js_incremental_update", "js_object_stream"])
def test_active_fails_active_content(tmp_path, name):
    result = checks.pdf_active(mf.build_reject_set(tmp_path)[name].pdf.read_bytes())
    assert not result.passed and result.severity == "reject"


def test_js_in_incremental_update_rejected(tmp_path):
    case = mf.build_reject_set(tmp_path)["js_incremental_update"]
    assert not checks.pdf_active(case.pdf.read_bytes()).passed


def test_js_in_object_stream_rejected(tmp_path):
    case = mf.build_reject_set(tmp_path)["js_object_stream"]
    assert not checks.pdf_active(case.pdf.read_bytes()).passed


def test_openaction_destination_is_allowed(tmp_path):
    out = tmp_path / "goto.pdf"
    with pikepdf.open(GOOD_PDF) as pdf:
        pdf.Root.OpenAction = pikepdf.Array([pdf.pages[0].obj, pikepdf.Name.Fit])
        pdf.save(out)
    assert checks.pdf_active(out.read_bytes()).passed


# --- sandbox ------------------------------------------------------------------

def test_sandbox_returns_child_result():
    assert sandbox.run(divmod, 7, 2, timeout=30) == (3, 1)


def test_sandbox_times_out():
    start = time.monotonic()
    with pytest.raises(sandbox.SandboxTimeout):
        sandbox.run(time.sleep, 30, timeout=1)
    assert time.monotonic() - start < 15


def test_sandbox_reports_child_crash():
    with pytest.raises(sandbox.SandboxError):
        sandbox.run(int, "not a number", timeout=30)


# --- meta.schema / pd.rule / pd.source / ban.source --------------------------

def test_meta_schema_passes_good_input():
    assert checks.meta_schema(_good_meta()).passed


def test_meta_schema_fails_extra_and_missing_fields():
    extra = {**_good_meta(), "price": 3}
    assert not checks.meta_schema(extra).passed
    missing = {k: v for k, v in _good_meta().items() if k != "title"}
    assert not checks.meta_schema(missing).passed


def test_pd_rule_passes_old_book():
    assert checks.pd_rule(_good_meta()).passed


def test_pd_rule_rejects_late_publication():
    meta = {**_good_meta(), "firstPublishedYear": 1931}
    result = checks.pd_rule(meta)
    assert not result.passed and result.severity == "reject"


def test_pd_rule_rejects_translator_who_died_after_1955():
    meta = _good_meta()
    meta["translators"] = [{"name": "Late Translator", "deathYear": 1956}]
    result = checks.pd_rule(meta)
    assert not result.passed and result.severity == "reject" and "Late Translator" in result.detail


def test_pd_rule_sends_unknown_death_year_to_review():
    meta = _good_meta()
    meta["authors"] = [{"name": "Anon", "deathYear": None}]
    result = checks.pd_rule(meta)
    assert not result.passed and result.severity == "review"


def test_pd_rule_boundaries_pass():
    meta = {**_good_meta(), "firstPublishedYear": 1930}
    meta["authors"] = [{"name": "Edge", "deathYear": 1955}]
    assert checks.pd_rule(meta).passed


@pytest.mark.parametrize("url,ok", [
    ("https://www.gutenberg.org/ebooks/76", True),
    ("https://archive.org/details/x", True),
    ("https://en.wikisource.org/wiki/X", True),
    ("https://babel.hathitrust.org/cgi/pt?id=x", True),
    ("https://gutenberg.org.evil.example/x", False),
    ("https://example.org/x", False),
])
def test_pd_source_allowlist(url, ok):
    meta = _good_meta()
    meta["publicDomain"] = {"sourceName": "x", "sourceUrl": url}
    result = checks.pd_source(meta)
    assert result.passed is ok and result.severity == "review"


def test_ban_source_needs_one_https_url():
    assert checks.ban_source(_good_meta()).passed
    meta = _good_meta()
    meta["bans"][0]["sourceUrl"] = "http://example.org/x"
    result = checks.ban_source(meta)
    assert not result.passed and result.severity == "reject"
    assert not checks.ban_source({**_good_meta(), "bans": []}).passed


# --- text and spam -------------------------------------------------------------

def test_text_extract_counts_words():
    analysis = checks.analyse_text(GOOD_PDF.read_bytes())
    assert analysis.word_count >= 2500
    assert checks.text_extract(analysis).passed


def test_text_extract_fails_image_only(tmp_path):
    pdf = mf.build_image_only_pdf(tmp_path / "img.pdf")
    result = checks.text_extract(checks.analyse_text(pdf.read_bytes()))
    assert not result.passed and result.severity == "review"


def test_text_match_finds_title_and_surname():
    analysis = checks.analyse_text(GOOD_PDF.read_bytes())
    assert checks.text_match(analysis, _good_meta()).passed


def test_text_match_fails_wrong_title():
    analysis = checks.analyse_text(GOOD_PDF.read_bytes())
    meta = {**_good_meta(), "title": "Entirely Different Volume", "authors": [{"name": "Zed Nobody", "deathYear": 1900}]}
    assert not checks.text_match(analysis, meta).passed


def test_spam_checks_pass_good_text():
    analysis = checks.analyse_text(GOOD_PDF.read_bytes())
    for check in (checks.spam_urls, checks.spam_repeat, checks.spam_keywords):
        assert check(analysis).passed, check.__name__


@pytest.mark.parametrize("name,check", [
    ("spam_urls", "spam_urls"),
    ("spam_keywords", "spam_keywords"),
    ("spam_repeat", "spam_repeat"),
])
def test_spam_checks_fail_spam_fixtures(tmp_path, name, check):
    case = mf.build_review_set(tmp_path)[name]
    result = getattr(checks, check)(checks.analyse_text(case.pdf.read_bytes()))
    assert not result.passed and result.severity == "review"


def test_keyword_match_uses_word_boundaries():
    analysis = checks.TextAnalysis.from_pages(["a cryptogram and a casinos-free text " * 50])
    assert checks.spam_keywords(analysis).passed


# --- dup.sha256 / dup.text -----------------------------------------------------

def test_dup_sha256_without_registry_is_skipped_pass():
    result = checks.dup_sha256("0x" + "0" * 64, lookup_id=None)
    assert result.passed and "not configured" in result.detail


def test_dup_sha256_existing_id_rejects():
    result = checks.dup_sha256("0x" + "1" * 64, lookup_id=lambda sha: 7)
    assert not result.passed and result.severity == "reject" and "7" in result.detail


def test_dup_text_detects_near_duplicate():
    index = checks.NearDupIndex()
    words = mf.random_words(1, 3000)
    index.add("book-1", words)
    near = list(words)
    near[10] = "changed"
    assert not checks.dup_text(near, index).passed
    assert checks.dup_text(mf.random_words(2, 3000), index).passed


def test_dup_text_without_index_passes():
    assert checks.dup_text(mf.random_words(1, 100), None).passed


# --- av.clamav -----------------------------------------------------------------

def test_clamav_infected_rejects():
    result = checks.av_clamav(b"data", runner=lambda data: (1, "stdin: Eicar FOUND"))
    assert not result.passed and result.severity == "reject"


def test_clamav_missing_is_skipped_unless_required(monkeypatch):
    monkeypatch.delenv("ALEXANDRIA_REQUIRE_CLAMAV", raising=False)
    assert checks.av_clamav(b"data", runner=None, find=lambda: None).passed
    monkeypatch.setenv("ALEXANDRIA_REQUIRE_CLAMAV", "1")
    assert not checks.av_clamav(b"data", runner=None, find=lambda: None).passed


def test_clamav_real_eicar(tmp_path):
    if checks.find_clamav() is None:
        pytest.skip("ClamAV not installed")
    result = checks.av_clamav(mf._eicar())
    if "error" in result.detail.lower():
        pytest.skip(f"ClamAV present but not usable: {result.detail}")
    assert not result.passed


# --- verdict and score ---------------------------------------------------------

def _c(passed, severity):
    return checks.ScanCheck(id="x", passed=passed, severity=severity, detail="")


def test_verdict_pass_when_all_pass():
    assert verdict_and_score([_c(True, "reject"), _c(True, "review")]) == ("pass", 100)


def test_verdict_review_and_score():
    assert verdict_and_score([_c(False, "review"), _c(False, "review"), _c(True, "reject")]) == ("review", 70)


def test_verdict_reject_wins():
    assert verdict_and_score([_c(False, "reject"), _c(False, "review")])[0] == "reject"


def test_score_floors_at_zero():
    assert verdict_and_score([_c(False, "review")] * 8) == ("review", 0)
