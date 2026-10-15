# Agent brief: A5, SDK (human: P3)

## Your job

Build `@alexandria/sdk`, the only code that talks to the chain, the IPFS gateways and the scanner API. The reader (A4) and A6's scripts use it. The SDK carries the project's core promise: **a reader gets a verified PDF even when RPCs and gateways are blocked, and never needs a wallet to read.**

Read `AGENTS.md`, `README.md` (sections 3.1, 3.2, 10, 11 and 13) and `docs/INTERFACES.md` (I1, I4, I5 and I7) before you start.

## You own (only edit these)

- `packages/sdk/` (except `src/types.ts` once G0 passes)
- `snapshots/`

**Never edit:**
- `apps/reader/` (A4 owns it)
- `contracts/`
- `deployments/`
- frozen interfaces
- anything else

## Stack

- TypeScript (strict), `viem` as the only runtime dependency, WebCrypto (`crypto.subtle`) for SHA-256.
- Tests: `vitest`.
- Build: `tsc` to ESM in `dist/`.
- Package name: `@alexandria/sdk`.
- `export { createClient } from './client'` and `export * from './types'`.

## Outputs others depend on

| Output | Needed by | Deadline |
|---|---|---|
| Read path + `downloadPdf` + `pdfFileName` | A4 | **H+8** |
| `submit`, `getPending`, `getSubmitTx`, `connectWallet` | A4 | H+11 |
| `scripts/build-snapshot.ts` → `snapshots/latest.json` | A4, A6 | H+13 |

## Tasks

- [ ] **T0 (H+0 – H+2):** set up the package. Do not create `src/types.ts` yourself: P4 adds it in the `rfc/g0-interfaces` PR (merged by H+1:30). Rebase on `main` after that merge.

- [ ] **T1 Catalog + book reads (H+2 – H+6)**
  - `getCatalog()`:
    1. Fetch `snapshotUrls` in order and use the first valid `Catalog`.
    2. Unless `live: false`, try a live read: a viem public client with a `fallback([...rpcUrls.map(u => http(u, { timeout: 8000 }))])` transport on `avalancheFuji`.
    3. Read `bookCount()`, then `getBook(i)` with `multicall` in batches of 100.
    4. Keep `approved` and `flagged`. Map the enum by index (1 pending, 2 approved, 3 rejected, 4 flagged).
    5. Fetch each `metaCid` through the gateways (race, 8 s timeout; `meta: null` on failure).
  - Return the live catalog with `source: 'live'`. If every RPC fails, return the snapshot with `source: 'snapshot'`.
  - It only throws `UNREACHABLE` when **both** paths fail.
  - `getBook(id)`: live only. Throws `UNKNOWN_BOOK` on the `UnknownBook` revert and `UNREACHABLE` otherwise.
  - Errors are `class AlexandriaError extends Error implements SdkError`.
  - **Tests** (mock transports, no network):
    - `catalog_uses_live_when_rpc_ok`
    - `catalog_falls_back_to_snapshot_when_all_rpcs_fail` (README Review focus 4)
    - `catalog_filters_out_pending_and_rejected`
    - `catalog_meta_null_when_gateways_fail`
    - `getBook_maps_unknown_book_error`

- [ ] **T2 Verified download (H+5 – H+8)**
  - Gateway URL: `${gw}/ipfs/${cid}`. `gw === ""` means the same origin (the onion path).
  - **Race with a stagger:** start gateway *i* at `i × 2000 ms`. Each attempt has its own `AbortController` and `gatewayTimeoutMs` (default 15000).
  - Read the body as a stream so `onProgress(bytesSoFar)` works, then hash it with `crypto.subtle.digest('SHA-256')` and compare with `book.pdfSha256` (lowercase `0x` hex).
  - On the first match, abort the other attempts and resolve with `new Blob([bytes], { type: 'application/pdf' })`.
  - A mismatch (HTML error page, cut-off file) **never resolves**. That attempt counts as failed and the race goes on.
  - When all attempts are done: throw `INTEGRITY` if any gateway returned bytes, otherwise `UNREACHABLE`.
  - `pdfFileName(book)`:
    1. Build `<title>-<first author surname>`.
    2. Apply NFKD and strip diacritics.
    3. Keep `[A-Za-z0-9-]` and collapse repeated `-`.
    4. Cut to 80 characters and append `.pdf`.
    5. If the result is empty (for example a Chinese or Farsi title), use `book-<id>.pdf`.
  - **Test helper** `test/mockGateway.ts`: a `node:http` server that serves `fixtures/pdfs/good.pdf` at `/ipfs/*` in four modes: `ok`, `html200`, `truncated`, `hang`.
  - **Tests:**
    - `download_verifies_and_returns_blob`
    - `download_html200_falls_back_to_next_gateway` (README Review focus 1)
    - `download_truncated_rejected`
    - `download_all_bad_throws_INTEGRITY`
    - `download_none_reachable_throws_UNREACHABLE`
    - `download_reports_progress`
    - `download_abort_signal_cancels`
    - `filename_ascii_title`
    - `filename_cjk_title_falls_back_to_book_id`
    - `filename_cyrillic_author_falls_back_safely` (README Review focus 2)

- [ ] **T3 Submit + curator + wallet (H+8 – H+11)**
  - `submit(pdf, meta)`: `fetch(apiBase + '/submit')` with multipart fields `pdf` and `meta` (JSON string).
    - 200 or 422 resolves with `SubmitResult`.
    - 409 throws `DUPLICATE` with `detail.existingId`.
    - 429 throws `RATE_LIMIT` with `detail.retryAfterSec`.
    - 413 throws `TOO_LARGE`; 400 throws `INVALID_INPUT`.
    - A network failure throws `UNREACHABLE`.
  - `getPending()`: live read with status = pending.
  - `getSubmitTx(id)`: `getLogs` for `BookSubmitted` with topic `id`, from `deployBlock`. Page in chunks of 2,048 blocks and halve the chunk size when the RPC errors. Return `null` if not found.
  - `connectWallet()`:
    - No `window.ethereum` throws `NO_WALLET`.
    - Call `eth_requestAccounts`, then `wallet_switchEthereumChain` with `0xa869`. On error 4902, call `wallet_addEthereumChain` (Fuji, RPC from config, explorer `https://testnet.snowtrace.io`).
    - If the switch is refused, throw `WRONG_CHAIN`.
    - Return `WalletActions` built on a viem wallet client. `review` and `flag` wait for 1 confirmation. A revert throws `TX_REVERTED`, with the decoded custom error name in `detail`.
  - **Tests:**
    - `submit_maps_each_status_code`
    - `submit_resolves_on_422_with_report`
    - `getSubmitTx_pages_and_shrinks_on_error`
    - `connectWallet_throws_NO_WALLET`
    - `connectWallet_adds_chain_on_4902`
    - `flag_maps_AlreadyFlagged_to_TX_REVERTED`

- [ ] **T4 Snapshot builder (H+11 – H+13)**
  - `scripts/build-snapshot.ts --deployment ../../deployments/fuji.json --out ../../snapshots/latest.json`:
    - does a live read and writes a `Catalog` with `source: 'snapshot'`;
    - includes approved and flagged books only, sorted by id;
    - inlines `meta`;
    - is deterministic: the same chain state gives byte-identical output (stable key order, `generatedAt` taken from the block timestamp).
  - **Tests:** `snapshot_is_deterministic`, `snapshot_validates_as_Catalog`.

- [ ] **T5 Integration (H+14 – H+20):** run the SDK tests against Fuji and the real gateways from `infra/gateways.json`. Report broken gateways to P4.

## Gotchas

- **Never read through `window.ethereum`.** Reads always use the configured RPCs, so they work with no wallet.
- Convert `bigint` to `number` only for ids, counts and timestamps. Keep hashes as hex strings.
- Some gateways redirect `/ipfs/<cid>` to a subdomain. `fetch` follows redirects, so treat a redirect as normal.
- Metadata JSON is not hash-verified (only the PDF has an on-chain hash). Never execute or `innerHTML` anything from it. Treat every string as plain text.
- No telemetry, no third-party calls besides the configured RPCs, gateways and `apiBase`.

## Ask P3 before

Adding a runtime dependency beyond `viem`.
