"""Send every <name>.pdf + <name>.json (BookMetaInput) in a folder through /api/submit.

    python -m ingest.submit_batch BOOKS_DIR [--api http://127.0.0.1:8000/api] [--dry-run]

--dry-run calls /api/scan instead: nothing is pinned or sent on-chain.
Books go one at a time with via=ubot, so they get the same scan as web uploads.
Results are printed as a table and saved to BOOKS_DIR/submit-results.json.
Exit code 0 only if every book was accepted (200, or pass/review on a dry run).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

import httpx

DEFAULT_API = "http://127.0.0.1:8000/api"
TIMEOUT_S = 600  # big books: scan + three pins + one on-chain confirmation
# Temporary test-phase toggle: set ALLOW_REUPLOADS = False (or env ALLOW_REUPLOADS=0 / --no-reuploads) to disable.
ALLOW_REUPLOADS = True


def _reuploads_default() -> bool:
    raw = os.environ.get("ALLOW_REUPLOADS")
    if raw is None:
        return ALLOW_REUPLOADS
    return raw.strip().lower() not in ("0", "false", "no")


@dataclass
class Row:
    name: str
    title: str = ""
    status: Optional[int] = None
    verdict: str = ""
    score: Optional[int] = None
    book_id: Optional[int] = None
    tx_hash: Optional[str] = None
    problems: str = ""

    def ok(self, dry_run: bool) -> bool:
        if dry_run:
            return self.status == 200 and self.verdict in ("pass", "review")
        return self.status == 200


def make_client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT_S)


def _failed_checks(report: dict) -> str:
    return ", ".join(c["id"] for c in report.get("checks", []) if not c.get("passed"))


def _send(client: httpx.Client, api: str, pdf: Path, meta_text: str, dry_run: bool,
          *, allow_reuploads: bool = False) -> httpx.Response:
    endpoint = "scan" if dry_run else "submit"
    url = f"{api.rstrip('/')}/{endpoint}"
    raw_pdf = pdf.read_bytes()
    response = client.post(url, files={"pdf": (pdf.name, raw_pdf, "application/pdf")},
                           data={"meta": meta_text, "via": "ubot"})
    if not dry_run and response.status_code == 409 and allow_reuploads:
        stamped = raw_pdf + f"\n% alexandria-reupload-{time.time_ns()}\n%%EOF\n".encode("ascii")
        response = client.post(url, files={"pdf": (pdf.name, stamped, "application/pdf")},
                               data={"meta": meta_text, "via": "ubot"})
    return response


def _row_from_response(row: Row, response: httpx.Response, dry_run: bool) -> Row:
    row.status = response.status_code
    try:
        body = response.json()
    except ValueError:
        row.problems = f"HTTP {response.status_code}, no JSON body"
        return row
    report = body if dry_run and "verdict" in body else body.get("report") or {}
    if report:
        row.verdict, row.score = report.get("verdict", ""), report.get("score")
        row.problems = _failed_checks(report)
    if not dry_run and response.status_code == 200:
        row.book_id, row.tx_hash = body.get("bookId"), body.get("txHash")
    if "code" in body:
        extra = body.get("existingId", body.get("retryAfterSec", body.get("detail", "")))
        row.problems = f"{body['code']} {extra}".strip()
    return row


def submit_folder(folder: Path, *, client: httpx.Client, api: str = DEFAULT_API, dry_run: bool = False,
                  allow_reuploads: Optional[bool] = None) -> list[Row]:
    if allow_reuploads is None:
        allow_reuploads = _reuploads_default()
    rows: list[Row] = []
    stopped: Optional[str] = None
    for pdf in sorted(Path(folder).glob("*.pdf")):
        row = Row(name=pdf.stem)
        rows.append(row)
        meta_path = pdf.with_suffix(".json")
        if not meta_path.is_file():
            row.problems = f"missing {meta_path.name}; not sent"
            continue
        meta_text = meta_path.read_text(encoding="utf-8")
        try:
            row.title = str(json.loads(meta_text).get("title", ""))
        except (ValueError, AttributeError):
            row.problems = f"{meta_path.name} is not a JSON object; not sent"
            continue
        if stopped:
            row.problems = f"not sent ({stopped})"
            continue
        try:
            response = _send(client, api, pdf, meta_text, dry_run, allow_reuploads=allow_reuploads)
        except httpx.HTTPError as exc:
            row.problems = f"API unreachable: {type(exc).__name__}"
            stopped = "API unreachable"
            continue
        _row_from_response(row, response, dry_run)
        if response.status_code == 429:
            stopped = "rate limited; rerun later"
    return rows


def format_table(rows: list[Row]) -> str:
    header = f"{'book':28} {'title':34} {'HTTP':>4} {'verdict':7} {'score':>5} {'id':>4}  problems"
    lines = [header, "-" * len(header)]
    for r in rows:
        lines.append(f"{r.name[:28]:28} {r.title[:34]:34} {r.status or '-':>4} {r.verdict or '-':7} "
                     f"{'-' if r.score is None else r.score:>5} {r.book_id or '-':>4}  {r.problems}")
    return "\n".join(lines)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m ingest.submit_batch")
    parser.add_argument("folder", type=Path, help="folder with <name>.pdf + <name>.json pairs")
    parser.add_argument("--api", default=DEFAULT_API, help=f"scanner API base (default {DEFAULT_API})")
    parser.add_argument("--dry-run", action="store_true", help="scan only (/api/scan); nothing stored or sent on-chain")
    reupload_group = parser.add_mutually_exclusive_group()
    reupload_group.add_argument("--allow-reuploads", dest="allow_reuploads", action="store_true",
                                default=None, help="allow re-uploading duplicate PDFs (default during test phase)")
    reupload_group.add_argument("--no-reuploads", dest="allow_reuploads", action="store_false",
                                help="reject duplicate PDFs with 409")
    args = parser.parse_args(argv)
    with make_client() as client:
        rows = submit_folder(args.folder, client=client, api=args.api, dry_run=args.dry_run,
                             allow_reuploads=args.allow_reuploads)
    print(format_table(rows))
    (args.folder / "submit-results.json").write_text(json.dumps([asdict(r) for r in rows], indent=2,
                                                                ensure_ascii=False), encoding="utf-8")
    accepted = sum(r.ok(args.dry_run) for r in rows)
    print(f"\n{accepted}/{len(rows)} accepted" + (" (dry run, nothing stored)" if args.dry_run else ""))
    return 0 if rows and accepted == len(rows) else 1


if __name__ == "__main__":
    sys.exit(main())

