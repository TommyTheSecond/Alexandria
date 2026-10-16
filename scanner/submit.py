"""/api/submit (I5): scan, then pin report, PDF and metadata, then relay on-chain."""

from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional, Protocol

from jsonschema import Draft202012Validator

from .checks import MAX_PDF_BYTES, NearDupIndex
from .checks.bounty import BountyCheck
from .checks.dup import LookupId
from .checks.meta import SCHEMA_PATH
from .pinning import PinError
from .pipeline import scan_detailed
from .relay import DuplicateBook, RelayError

log = logging.getLogger("alexandria.scanner")
VIA = ("web", "ubot")
# Toggle temporary re-upload support for testing phase (override via ALLOW_REUPLOADS=0 in scanner/.env).
ALLOW_REUPLOADS_DEFAULT = True


class PinnerLike(Protocol):
    def pin(self, data: bytes, filename: str) -> str: ...


class RelayLike(Protocol):
    def relay(self, pdf_cid: str, meta_cid: str, pdf_sha256: str) -> tuple[int, str]: ...


@dataclass(frozen=True)
class SubmitResponse:
    status: int
    body: dict


@lru_cache(maxsize=1)
def _book_validator() -> Draft202012Validator:
    return Draft202012Validator(json.loads(SCHEMA_PATH.read_text(encoding="utf-8")))


def _json_bytes(obj: object) -> bytes:
    return json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")


def _result(report: dict, book_id=None, tx_hash=None, pdf_cid=None, meta_cid=None) -> dict:
    return {"report": report, "bookId": book_id, "txHash": tx_hash, "pdfCid": pdf_cid, "metaCid": meta_cid}


class SubmitService:
    def __init__(self, *, pinner: PinnerLike, relay: RelayLike, data_dir: Path, lookup_id: LookupId = None,
                 near_dup: Optional[NearDupIndex] = None, timeout: float = 60,
                 bounty_check: Optional[BountyCheck] = None, allow_reuploads: bool = False) -> None:
        self.pinner = pinner
        self.relay = relay
        self.data_dir = Path(data_dir)
        self.lookup_id = lookup_id
        self.near_dup = near_dup
        self.timeout = timeout
        self.bounty_check = bounty_check
        self.allow_reuploads = allow_reuploads

    def _existing_id(self, sha256: str) -> int:
        if self.lookup_id is None:
            return 0
        try:
            return int(self.lookup_id(sha256))
        except Exception:  # RPC down: the scan marks dup.sha256 for review instead
            return 0

    def _store_report(self, report: dict) -> None:
        path = self.data_dir / "reports" / f"{report['pdfSha256']}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(_json_bytes(report))

    def submit(self, pdf: bytes, meta: object, *, via: str, sha256: str, total_size: int) -> SubmitResponse:
        if total_size > MAX_PDF_BYTES:
            return SubmitResponse(413, {"code": "TOO_LARGE", "detail": f"limit is {MAX_PDF_BYTES} bytes"})
        if via not in VIA:
            return SubmitResponse(400, {"code": "INVALID_INPUT", "detail": "via must be 'web' or 'ubot'"})
        existing = self._existing_id(sha256)
        if existing:
            if not self.allow_reuploads:
                return SubmitResponse(409, {"code": "DUPLICATE", "existingId": existing})
            stamp = f"\n% alexandria-reupload-{time.time_ns()}\n%%EOF\n".encode("ascii")
            pdf = pdf + stamp
            total_size = len(pdf)
            if total_size > MAX_PDF_BYTES:
                return SubmitResponse(413, {"code": "TOO_LARGE", "detail": f"limit is {MAX_PDF_BYTES} bytes"})
            sha256 = "0x" + hashlib.sha256(pdf).hexdigest()

        outcome = scan_detailed(pdf, meta, lookup_id=self.lookup_id, near_dup=self.near_dup,
                                timeout=self.timeout, sha256=sha256, total_size=total_size,
                                bounty_check=self.bounty_check)
        report = outcome.report
        if report["verdict"] == "reject":
            return SubmitResponse(422, _result(report))

        try:
            report_cid = self.pinner.pin(_json_bytes(report), "report.json")
            pdf_cid = self.pinner.pin(pdf, "book.pdf")
            full_meta = {
                "schemaVersion": "1.0.0",
                **meta,
                "pdf": {"cid": pdf_cid, "sha256": sha256, "bytes": total_size, "pages": outcome.pages},
                "submittedVia": via,
                "scanReportCid": report_cid,
            }
            errors = list(_book_validator().iter_errors(full_meta))
            if errors:
                return SubmitResponse(400, {"code": "INVALID_INPUT", "detail": errors[0].message[:300]})
            meta_cid = self.pinner.pin(_json_bytes(full_meta), "meta.json")
        except PinError as exc:
            return SubmitResponse(502, {"code": "PIN_ERROR", "detail": str(exc)[:300]})
        self._store_report(report)

        try:
            book_id, tx_hash = self.relay.relay(pdf_cid, meta_cid, sha256)
        except DuplicateBook as exc:
            return SubmitResponse(409, {"code": "DUPLICATE", "existingId": exc.existing_id})
        except RelayError as exc:
            # Pins and the report stay; a retry hits the duplicate check or succeeds.
            return SubmitResponse(502, {"code": "RELAY_ERROR", "detail": str(exc)[:300]})

        if self.near_dup is not None:
            self.near_dup.add(sha256, outcome.words)
            self.near_dup.save(self.data_dir / "minhash.pkl")
        log.info("submitted book %s tx %s", book_id, tx_hash)
        return SubmitResponse(200, _result(report, book_id, tx_hash, pdf_cid, meta_cid))
