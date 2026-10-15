"""scan(): run every check on one upload and build the ScanReport (I3)."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Callable, Optional

from . import __version__, checks, sandbox
from .checks import ScanCheck
from .checks.dup import LookupId, NearDupIndex
from .verdict import verdict_and_score

PARSE_TIMEOUT_S = 60


def parse_in_child(data: bytes) -> dict:
    """Everything that parses the PDF. Runs inside sandbox.run()."""
    parse = checks.pdf_parse(data)
    if not parse.passed:
        return {"parse": parse, "active": None, "analysis": None}
    return {"parse": parse, "active": checks.pdf_active(data), "analysis": checks.analyse_text(data)}


def scan(pdf: bytes, meta: object, *, lookup_id: LookupId = None, near_dup: Optional[NearDupIndex] = None,
         timeout: float = PARSE_TIMEOUT_S, av: Callable[[bytes], ScanCheck] = checks.av_clamav,
         sha256: Optional[str] = None, total_size: Optional[int] = None) -> dict:
    """Scan one PDF + BookMetaInput.

    `sha256` and `total_size` describe the whole upload when the caller only kept
    the first MAX_PDF_BYTES + 1 bytes of an oversized file.
    """
    sha = sha256 or "0x" + hashlib.sha256(pdf).hexdigest()
    meta_dict = meta if isinstance(meta, dict) else {}
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
            if child["active"] is not None:
                results.append(child["active"])
            analysis = child["analysis"]
            if analysis is not None:
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
    verdict, score = verdict_and_score(results)
    return {
        "schemaVersion": "1.0.0",
        "pdfSha256": sha,
        "scannerVersion": __version__,
        "score": score,
        "verdict": verdict,
        "checks": [r.to_dict() for r in results],
        "scannedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
