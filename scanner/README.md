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
| `GET /api/report/{sha256}` | done; `/api/submit` stores each report |
| `POST /api/submit` (multipart `pdf` + `meta`, optional `via` = `web` or `ubot`) | done; off (503) until `RELAY_SECRET` is set |

## Configure `/api/submit`

Copy `scanner/.env.example` to `scanner/.env` (gitignored) and fill in at least `RELAY_SECRET`. The scanner needs:

- **Kubo** on `127.0.0.1:5001`. It is required, and its CIDs are the ones that go on-chain.
- **The relayer** (I6) on `127.0.0.1:8787`, with the same `RELAY_SECRET`.
- **`deployments/fuji.json`**, so the scanner can check `idBySha256` for duplicates. Without it, `dup.sha256` is skipped and the relayer still refuses duplicates.
- **Filebase** (optional): `FILEBASE_BUCKET`, `FILEBASE_ACCESS_KEY_ID` and `FILEBASE_SECRET_ACCESS_KEY`.
  - Each pinned object is exported from Kubo as a CAR and uploaded with the metadata `import=car`, so Filebase keeps Kubo's CID.
  - If Filebase reports a different CID, the scanner logs a warning.
  - A Filebase failure never blocks an upload.

What `/api/submit` does, in order:
1. Check the size limit and the duplicate registry. Answer 413 or 409 if either fails.
2. Scan. A `reject` verdict answers **422**, and nothing is stored.
3. Pin the scan report, then the PDF, then the full `BookMeta` (I2). The metadata includes `pdf.cid` and `scanReportCid`.
4. Store the report under `data/reports/<sha256>.json`, for `GET /api/report`.
5. Call the relayer, then answer **200** with `SubmitResult`. A relayer duplicate answers 409. Other relayer failures answer 502 `RELAY_ERROR`, and the pins stay, so a retry is safe.
6. Add the book's text to the near-duplicate index.

**Rate limits:** 5 uploads per hour per client and 200 per day in total, counted in memory.
- The client key is `sha256(daily salt + IP)`, and the raw IP is never stored.
- `X-Forwarded-For` is trusted only from a loopback proxy (Caddy, cloudflared).
- Tor users have no client IP, so only the daily total applies to them.

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
- `dup.sha256` asks the registry with a read-only `eth_call` when `deployments/fuji.json` exists. `dup.text` compares against every book submitted through this scanner.

## Tests

```bash
python fixtures/make_fixtures.py   # optional: rebuild fixtures
pytest scanner
```
