"""scan(): run every check on one upload and build the ScanReport (I3)."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Optional

from . import __version__, checks, sandbox
from .checks import ScanCheck
from .checks.bounty import BountyCheck
from .checks.dup import LookupId, NearDupIndex
from .verdict import verdict_and_score

PARSE_TIMEOUT_S = 60


@dataclass
class ScanOutcome:
    report: dict
    pages: int = 0                                  # 0 when the PDF was never parsed
    words: list[str] = field(default_factory=list)  # for the near-duplicate index


def parse_in_child(data: bytes) -> dict:
    """Everything that parses the PDF. Runs inside sandbox.run()."""
    parse = checks.pdf_parse(data)
    if not parse.passed:
        return {"parse": parse, "active": None, "analysis": None, "pages": 0}
    return {"parse": parse, "active": checks.pdf_active(data), "analysis": checks.analyse_text(data),
            "pages": checks.page_count(data)}


def scan_detailed(pdf: bytes, meta: object, *, lookup_id: LookupId = None, near_dup: Optional[NearDupIndex] = None,
                  timeout: float = PARSE_TIMEOUT_S, av: Callable[[bytes], ScanCheck] = checks.av_clamav,
                  sha256: Optional[str] = None, total_size: Optional[int] = None,
                  bounty_check: Optional[BountyCheck] = None) -> ScanOutcome:
    """Scan one PDF + BookMetaInput.

    `sha256` and `total_size` describe the whole upload when the caller only kept
    the first MAX_PDF_BYTES + 1 bytes of an oversized file.
    """
    sha = sha256 or "0x" + hashlib.sha256(pdf).hexdigest()
    meta_dict = meta if isinstance(meta, dict) else {}
    pages, words, analysis = 0, [], None
    results: list[ScanCheck] = [
        checks.pdf_magic(pdf),
        checks.pdf_size(total_size if total_size is not None else len(pdf)),
    ]
    if all(r.passed for r in results):
        results.append(av(pdf))
        results.append(checks.dup_sha256(sha, lookup_id))
        try:
            child = sandbox.run(parse_in_child, pdf, timeout=timeout)
        except sandbox.SandboxTimeout as exc:
            results.append(checks.fail("pdf.parse", "reject", f"parser {exc}"))
        except sandbox.SandboxError as exc:
            results.append(checks.fail("pdf.parse", "reject", f"parser failed: {exc}"))
        else:
            results.append(child["parse"])
            pages = child["pages"]
            if child["active"] is not None:
                results.append(child["active"])
            analysis = child["analysis"]
            if analysis is not None:
                words = analysis.words
                results += [
                    checks.text_extract(analysis),
                    checks.text_match(analysis, meta_dict),
                    checks.spam_urls(analysis),
                    checks.spam_repeat(analysis),
                    checks.spam_keywords(analysis),
                    checks.dup_text(analysis.words, near_dup),
                ]
    else:
        results.append(av(pdf))
    results += [
        checks.meta_schema(meta),
        checks.pd_rule(meta_dict),
        checks.pd_source(meta_dict),
        checks.ban_source(meta_dict),
    ]
    # Bounty uploads only (I9). Severity review, never reject, and it can never break a scan.
    if bounty_check is not None and isinstance(meta_dict.get("bountyId"), int):
        try:
            results.append(bounty_check(meta_dict, analysis, results))
        except Exception as exc:  # noqa: BLE001
            results.append(checks.fail("bounty.match", "review",
                                       f'{{"bountyId":{meta_dict["bountyId"]},"match":"unsure","auto":false,'
                                       f'"error":"check failed ({type(exc).__name__})"}}'))
    verdict, score = verdict_and_score(results)
    report = {
        "schemaVersion": "1.0.0",
        "pdfSha256": sha,
        "scannerVersion": __version__,
        "score": score,
        "verdict": verdict,
        "checks": [r.to_dict() for r in results],
        "scannedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    return ScanOutcome(report=report, pages=pages, words=words)


def scan(pdf: bytes, meta: object, **kwargs) -> dict:
    return scan_detailed(pdf, meta, **kwargs).report
