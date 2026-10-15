# Ingest (A3)

Load prepared books through the scanner, exactly like web uploads (README 8.3, step 6).

A books folder holds one pair per book: `<name>.pdf` plus `<name>.json` (a `BookMetaInput`, I2 minus the scanner-filled fields). Keep the folder **outside git**; the PDFs go to IPFS, not the repo.

```bash
# 1. Scan only: nothing pinned, nothing on-chain
python -m ingest.submit_batch /path/to/books --dry-run

# 2. Real upload, once the relayer and deployments/fuji.json are live on the scanner host
python -m ingest.submit_batch /path/to/books --api http://127.0.0.1:8000/api
```

- Books go one at a time with `via=ubot`.
- The tool prints a table (HTTP status, verdict, score, book id, failed checks or error code) and saves it to `<folder>/submit-results.json`.
- It stops at the first `429` and marks the rest as not sent. Rerun later; the duplicate check (409) skips books already on-chain.
- Exit code `0` only if every book was accepted.
