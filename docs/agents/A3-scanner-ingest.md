# Agent brief: A3, Scanner + ingest (human: P2)

## Your job

Build the **spam and junk scanner**, the gate every upload passes before anything is stored. Then build the **ingest tools** that turn P2's U-bot output into uploads. You also own the test fixtures that everyone else builds against.

Read `AGENTS.md`, `README.md` (sections 3.2, 6, 8, 10, 11 and 13) and `docs/INTERFACES.md` (I2, I3, I5 and I6) before you start.

## You own (only edit these)

- `scanner/`
- `ingest/`
- `fixtures/`

`schemas/` is created by P4 in the G0 interface PR. You only read it.

**Never edit:**
- `relayer/` (A2 owns it)
- `infra/` (A6 owns it)
- frozen interfaces
- anything else

## Stack

- Python 3.11+, with `requirements.txt` pinned.
- Libraries: `fastapi`, `uvicorn`, `python-multipart`, `pikepdf`, `pymupdf`, `datasketch`, `jsonschema`, `boto3` (Filebase S3 at `https://s3.filebase.com`), `httpx` (Kubo and relayer), `web3` (read-only `idBySha256`), `pytest`.
- ClamAV through `clamdscan`, called as a subprocess.

## Outputs others depend on

| Output | Needed by | Deadline |
|---|---|---|
| `fixtures/catalog.json` + `fixtures/pdfs/good.pdf` + `fixtures/meta/*.json` | A4, A5, A1 (SeedAnvil) | **H+2** |
| `/api/scan` working | A5, A6 | **H+8** |
| `/api/submit` working (pin + relay) | A4, A5, P2 | H+12 |
| `ingest/` tools | P2 | H+14 |

## Tasks

- [ ] **T0 Fixtures (H+0 – H+2).** `fixtures/make_fixtures.py` must run **offline** and use **no copyrighted text**.
  - Commit `fixtures/pdfs/good.pdf`:
    - 12 pages, about 2,500 words of seeded random words from a built-in list of 500 common English words, so it passes `spam.repeat`.
    - Page 1 shows the title "Fixture Book" and the author "Ada Fixture".
    - No JavaScript.
  - Commit `fixtures/meta/good.json` (`BookMetaInput`) and `fixtures/catalog.json` (a `Catalog` with 3 books):
    - one approved, one flagged, one approved with a **Chinese title and a Russian author name** (README Review focus 2);
    - correct `pdfSha256` values for `good.pdf`;
    - well-formed fake CIDs.
  - **Generate the bad files at test time** into `fixtures/out/` (gitignored), so antivirus does not quarantine committed files.
    - **Reject set (≥ 10):**
      - `notpdf.pdf` (PNG bytes)
      - `too_large.pdf` (31,457,281 bytes)
      - `encrypted.pdf`
      - `five_pages.pdf`
      - `js_openaction.pdf`
      - `js_incremental_update.pdf` (clean PDF plus an appended update that adds `/JS`)
      - `js_object_stream.pdf` (JavaScript action stored inside an object stream)
      - `launch_action.pdf`
      - `embedded_file.pdf`
      - `eicar.pdf` (EICAR test string, only when ClamAV is installed)
      - meta files: published 1990; author died 1980; no ban source
    - **Review set:** `spam_urls.pdf`, `spam_keywords.pdf`, `spam_repeat.pdf`, `no_text.pdf` (images only).
  - *Done when:* `python fixtures/make_fixtures.py` creates every file, and A4 and A5 can load `fixtures/catalog.json`.

- [ ] **T1 Checks + `/api/scan` (H+2 – H+8)**
  - Use one module per check family:
    - `scanner/checks/pdf.py`
    - `scanner/checks/av.py`
    - `scanner/checks/dup.py`
    - `scanner/checks/meta.py`
    - `scanner/checks/pd.py`
    - `scanner/checks/text.py`
    - `scanner/checks/spam.py`
  - Each check returns `ScanCheck(id, passed, severity, detail)`. The check IDs, rules and severities are the table in README section 6, exactly.
  - `scanner/verdict.py` computes the verdict and score as README section 6 defines them.
  - `scanner/sandbox.py` runs PDF parsing in a **subprocess** with a 60 s timeout. On Linux (WSL2 or Docker) it also sets `resource.setrlimit` to 1 GB of memory. A timeout or crash means `pdf.parse` fails, which is a reject.
  - `pdf.active` must walk **every object** with pikepdf (`pdf.objects`), including objects that came from object streams and incremental updates.
    - Reject keys: `/JS`, `/JavaScript`, `/Launch`, `/EmbeddedFile`, `/EmbeddedFiles`, `/RichMedia`, `/XFA`, `/AA`.
    - `/OpenAction` is a reject **only if it is an action dictionary** (has `/S`). A destination array (jump to a page) is harmless, and Calibre output may contain one.
  - `pd.rule`:
    - `firstPublishedYear ≤ 1930` and every author and translator has `deathYear ≤ 1955`.
    - Any known year that breaks the rule means reject.
    - Any `null` year means review.
  - `scanner/api.py` serves `/api/health`, `/api/scan` and `/api/report/{sha256}` as in I5.
    - CORS: `*` origins, no credentials.
    - Start with `uvicorn scanner.api:app --host 127.0.0.1 --port 8000 --no-access-log`.
  - `python -m scanner scan <pdf> --meta <json>` prints the report. Curators use it.
  - **Tests** (`scanner/tests/`):
    - one test per check, pass and fail;
    - `test_every_reject_fixture_is_rejected`;
    - `test_review_fixtures_get_review`;
    - `test_good_fixture_passes`;
    - `test_js_in_incremental_update_rejected` and `test_js_in_object_stream_rejected` (README Review focus 3);
    - `test_openaction_destination_is_allowed`;
    - `test_parser_timeout_rejects`;
    - `test_report_matches_schema` (validate against `schemas/scan-report.schema.json`).
  - *Done when:* `pytest scanner` passes, and the reject rate on the reject set is 100% (README success criterion 4). Put the count in the PR.

- [ ] **T2 `/api/submit` (H+8 – H+12)**
  - Follow the step order in I5 exactly.
  - **Rate limits:** 5 per hour per IP and 200 per day in total. Keep them in memory, keyed by `sha256(ip + daily_salt)`. Never store the raw IP.
  - **Pinning order:** report, then PDF, then metadata. Pin to **Kubo** (`POST http://127.0.0.1:5001/api/v0/add?cid-version=1&pin=true`) and to **Filebase**.
  - **CID check at H+9:** upload `good.pdf` both ways and compare the CIDs. If they differ, use Filebase's CAR import (export from Kubo with `ipfs dag export`) so the network and on-chain CID are the same everywhere. Record which method works in `scanner/README.md`.
  - Call the relayer (I6) with `RELAY_SECRET` from `.env`. If the relayer fails after pinning, return 502 and keep the pins. The upload can be retried, and the duplicate check returns the existing id.
  - **Near-duplicates:** keep a MinHash index (5-word shingles, 128 permutations) in `scanner/data/` (gitignored). Add approved books to it.
  - **Tests:** mock Filebase and the relayer, and run a real Kubo if one is available.
    - `test_reject_stores_nothing`
    - `test_pass_pins_report_pdf_meta_in_order`
    - `test_duplicate_returns_409_existing_id`
    - `test_rate_limit_429_after_5`
    - `test_raw_ip_never_stored`
  - *Done when:* one real end-to-end upload of `good.pdf` with fixture metadata gives a Pending book on Fuji. Ask P2 before the first real submit.

- [ ] **T3 Ingest (H+12 – H+14)**
  - `ingest/match_pg.py`:
    - Reads `ingest/candidates.csv` (columns in README 8.3) and `pg_catalog.csv`.
    - P2 downloads `pg_catalog.csv` once from the offline catalog page. **Never crawl gutenberg.org.**
    - Parses the `Authors` field's birth–death years.
    - Applies the public-domain rule and writes `ingest/shortlist.csv` with the Gutenberg id and a `pd_ok` column.
  - `ingest/submit_batch.py <dir>`:
    - For each `<name>.pdf` + `<name>.json` pair, calls `POST /api/submit` with `via=ubot`.
    - Prints a table of title, verdict, score, book id and failed checks.
    - Stops if the API returns 429 and shows `retryAfterSec`.
  - **Tests:** `test_match_pg_parses_years`, `test_match_pg_flags_translator_after_1955`, `test_submit_batch_reports_each_result`.

- [ ] **T4 Integration (H+14 – H+20):** keep the scanner running. Help P2 load ≥ 10 books. Fix false rejects without weakening reject-level checks. If a real book fails `text.match` because of Gutenberg's header, look further into the text instead of dropping the check.

## Gotchas

- The scanner holds the Filebase key and talks to the relayer. **Never run PDF parsing in the main process.**
- A Calibre PDF of a Gutenberg book should pass. If it does not, show the failing check to P2 before changing anything.
- Keep the Gutenberg licence text inside each PDF. Do not strip it.

## Ask P2 before

Any real upload to Filebase, any real submit to Fuji, any unpin, and any change that relaxes a reject-level check.
