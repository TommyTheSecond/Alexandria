# Agent brief: A4, Reader UI (human: P3)

## Your job

Build the Alexandria website. Visitors browse banned books, read their ban history, **download the PDF**, upload a book, and (curators only) approve submissions. The look is **typewriter art plus electric-blue CRT ASCII**. It must still be calm, readable and accessible, and it must work over slow, censored networks and Tor.

Read `AGENTS.md`, `README.md` (sections 3, 7, 10, 11 and 12) and `docs/INTERFACES.md` (I4) before you start.

## You own (only edit these)

- `apps/reader/`

**Never edit:**
- `packages/sdk/` (A5 owns it)
- `assets/` (A6 makes the ASCII art)
- `infra/`
- frozen interfaces
- anything else

## Stack

- Vite 5, Preact, TypeScript (strict), plain CSS with custom properties.
- Tests: `vitest` for components; Playwright with `@axe-core/playwright` for end-to-end and accessibility.
- `pdfjs-dist` only as a lazy-loaded stretch goal (inline reading). Download comes first.
- Package name: `@alexandria/reader`.
- Vite `base: './'`, **hash routing** (`#/`, `#/book/<id>`, `#/upload`, `#/curate`, `#/about`).

## Inputs

- `@alexandria/sdk` (workspace). Until A5 ships it at H+8, write `src/mock/mockClient.ts` that implements `AlexandriaClient` from `fixtures/catalog.json`. Switch with `VITE_USE_MOCK=1`.
- `assets/art/hero-{100,72,40}.txt` + `assets/art/hero.alt.txt` (A6, H+8). Use a placeholder until then.
- `deployments/fuji.json`, `infra/gateways.json`, `infra/rpcs.json`.
- At startup, fetch runtime `./config.json`. A6 may overwrite it at deploy time (for example a new tunnel URL for `apiBase`). Fall back to the build-time values.
- Prebuild step: copy `snapshots/latest.json` (or `fixtures/catalog.json` in mock mode) to `public/catalog.json`.

## Tasks

- [ ] **T1 Theme + shell (H+2 – H+5)**
  - Tokens exactly as in README section 7, for paper and terminal mode.
  - Mode follows `prefers-color-scheme`. A toggle saves the choice in `localStorage` inside try/catch.
  - Self-host the WOFF2 files for **Special Elite** and **Courier Prime** in `public/fonts/`, with their licence files. Download them once from the fonts' official sources. **No Google Fonts link at runtime.**
  - Header with the wordmark `ALEXANDRIA`. `<TypeHeading>` animates typing for headings only, ≤ 1.5 s, and is off under `prefers-reduced-motion`.
  - Footer: "Unaudited · Fuji testnet only" and the access paths.
  - Use logical CSS properties only (`margin-inline`, `padding-block`, `inset-inline-start`), so right-to-left works later.
  - *Done when:* the shell renders in both modes, and a contrast check of every token pair is ≥ 4.5:1. Note the ratios in the PR.

- [ ] **T2 Catalog page `#/` (H+5 – H+8)**
  - Hero: `<pre aria-hidden="true">` with the width-matched ASCII art, a scanline overlay (`repeating-linear-gradient`) **on the art only**, and a visually hidden description from `hero.alt.txt`.
  - Search (title or author, client-side), a country filter (ISO codes in the data) and a scope filter.
  - Book cards with box-drawing borders (`┌─┐`). They show the title, authors, first publication year, ban countries as text (`US · RU · CN`) and an "under review" badge when flagged.
  - Snapshot banner: when `catalog.source === 'snapshot'`, show "Showing saved catalog · data as of block N" (README Review focus 4).
  - *Done when:* Playwright `catalog_renders_fixture_books`, `search_filters_by_author`, `country_filter_works` and `snapshot_banner_shows_when_offline` pass in mock mode.

- [ ] **T3 Book page `#/book/<id>` + download (H+8 – H+11)**
  - Show the title, authors, translators, years, description, a **ban timeline** (year · country · authority · scope · source link) and the public-domain source link.
  - **Download PDF** button: label `Download PDF · 2.4 MB`, with a progress bar from `onProgress`. Then save the Blob through an object URL with `client.pdfFileName(book)` and revoke the URL afterwards.
  - Error states:
    - `INTEGRITY`: "A gateway sent a damaged copy. Nothing was saved."
    - `UNREACHABLE`: "No gateway reachable. Try the onion mirror: <address>."
  - On-chain panel: status, submitter, submitted date, `getSubmitTx` link to `https://testnet.snowtrace.io/tx/<hash>`.
  - Flag button: a dialog asks for a reason. `connectWallet()` runs **only on click**, then `flag()`. Show `TX_REVERTED` errors in plain words (for example "You already flagged this book").
  - **Connect dialog** (shared by Flag and `#/curate`, see README section 3.4) has two buttons:
    - **Browser wallet:** `connectWallet('injected')`. Hide it when `window.ethereum` is missing.
    - **WalletConnect (QR / mobile):** `connectWallet('walletconnect')`. Hide it when `walletConnectProjectId` is empty.
    - If neither is available, say so and point to the about page.
    - `NO_WALLET` with `detail: 'cancelled'` closes the dialog quietly.
    - Once connected, show the short address and a **Disconnect** button that calls `disconnect()`.
  - A flagged book keeps its Download button (README Review focus 5).
  - *Done when:* Playwright tests pass:
    - `download_saves_pdf_with_expected_name` (check the Playwright download event and the file name)
    - `download_corrupt_gateway_falls_back` (mock gateway returns HTML 200 first)
    - `flagged_book_still_downloadable`
    - `cjk_title_renders` (the Chinese-title fixture)
    - `no_walletconnect_requests_before_click`: record network requests on `#/` and `#/book/1`; none may go to a WalletConnect host or load the WalletConnect chunk until the user clicks "Connect with WalletConnect"
    - `connect_dialog_hides_walletconnect_without_project_id`

- [ ] **T4 Upload page `#/upload` (H+11 – H+13)**
  - Form for `BookMetaInput`, with repeatable groups for authors, translators and bans, and `deathYear` allowed to be unknown.
  - Client checks before sending:
    - PDF type and `%PDF-` magic (read the first 5 bytes)
    - size ≤ 31,457,280 bytes
    - all required fields
    - a plain-language explanation of the public-domain rule
  - After submit, show the `ScanReport` as a table: check, result, detail. Then show the result: "Rejected: <failed checks>" or "Submitted as book #N. A curator will review it."
  - Map errors: `DUPLICATE` gives a link to the existing book; `RATE_LIMIT` shows the wait time; `TOO_LARGE` asks for a smaller file.
  - **No wallet on this page.**
  - *Done when:* `upload_shows_report_on_reject` and `upload_shows_book_id_on_success` pass (mock client).

- [ ] **T5 Curate page `#/curate` (H+11 – H+14)**
  - "Connect wallet" button, then `isCurator()`. A non-curator sees "This wallet is not a curator."
  - Pending queue from `getPending()`, sorted by scan score (`/api/report/<sha>`). Each item shows the failed checks, links to download the PDF and to view the metadata, and Approve and Reject buttons with a reason field.
  - *Done when:* `curate_lists_pending_sorted_by_score` passes (mock).

- [ ] **T6 About page + noscript (H+12 – H+14)**
  - About: mission and the name (the burned library), the public-domain rule, how to reach the site (onion address, gateways, IPFS CID of the site), "unaudited, testnet only".
  - `<noscript>`: the onion address and a link to `./catalog.json`.

- [ ] **T7 Accessibility + performance gate (H+14 – H+18)**
  - `a11y_no_serious_violations` runs axe on all 5 pages, in both modes. Target: 0 serious or critical violations.
  - Keyboard-only walk-through: every action reachable, visible focus ring.
  - Bundle: run `vite build`, then a script prints the gzip size of the entry JS. Target: ≤ 150 KB, pdf.js excluded.
  - Chrome DevTools "Fast 3G": catalog first render ≤ 5 s. Write the measured seconds in the PR.

## Design notes from the references

- *Typewriter art:* cream paper, dark ink, pictures made of real words. Use it in the hero and in section dividers built from letters.
- *Blue CRT:* deep electric blue with pale scanlines. Use it for terminal mode and as the accent colour.
- **Readability beats effect.** Never put scanlines, animation or ASCII noise behind body text.

## Ask P3 before

Adding any runtime dependency over 20 KB gzip, or loading anything from a third-party origin.
