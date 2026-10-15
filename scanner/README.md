# Scanner (A3)

The spam and junk gate for every upload (README section 6, API I5).

## Run

```bash
pip install -r scanner/requirements.txt
python3 -m uvicorn scanner.app:app --host 127.0.0.1 --port 8000 --no-access-log
```

Run from the repo root: the scanner reads `schemas/book.schema.json`. Caddy forwards `/api/*` unchanged.

| Route | Status |
|---|---|
| `GET /api/health` | done |
| `POST /api/scan` (multipart `pdf` + `meta`) | done; stores nothing |
| `GET /api/report/{sha256}` | done; reports appear once `/api/submit` stores them |
| `POST /api/submit` | next task (T2) |

## Curator CLI

```bash
python -m scanner scan book.pdf --meta book.json
```

It prints the report. Exit code: `0` pass, `1` review, `2` reject.

## How it works

- `pipeline.scan()` runs every check from README section 6 and builds the `ScanReport` (I3).
- PDF parsing (`pdf.parse`, `pdf.active`, text analysis) runs in a **separate process** (`sandbox.py`). The limits are 60 s and, on Linux, 1 GB of memory. A timeout or crash means reject.
- `pdf.active` walks every PDF object with pikepdf, so JavaScript hidden in object streams or incremental updates is caught. An `/OpenAction` that only jumps to a page is allowed.
- `spam.repeat` measures the unique-word ratio on the first 5,000 words. Long real books would otherwise look repetitive, because the ratio falls as text gets longer.
- `av.clamav` uses `clamdscan`, then `clamscan`. If neither is installed, the check is skipped, unless `ALEXANDRIA_REQUIRE_CLAMAV=1` is set; then the upload is rejected. A ClamAV error sends the book to curator review.
- `dup.sha256` is skipped until the registry lookup is wired in (T2). `dup.text` is skipped until approved books are indexed.

## Tests

```bash
python fixtures/make_fixtures.py   # optional: rebuild fixtures
pytest scanner
```
