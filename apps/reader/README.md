# Barebones reader

Run `npm install`, then `npm run dev`. Run `npm test` and `npm run build` for checks.

This A4 prototype uses Preact, Vite 5 and strict TypeScript. It deliberately has no decorative theme. Buttons remain semantic buttons styled as text.

The catalog loads `public/catalog.json`; the checked-in snapshot is empty because content fixtures have not landed on main. Replace it with the real snapshot when available. Search and country/scope filters work on approved and flagged books. Metadata is rendered as text.

Upload currently validates PDF magic and size locally. It does not send files. SDK downloads, submission, wallet actions and curator queue are explicitly marked as not connected. No shared SDK interfaces are created or edited.

## Local samples

Run `node scripts/prepare-samples.mjs` and visit `http://127.0.0.1:5173/?samples=1#/`. This downloads two historical Internet Archive scans: Alice (1890 edition; Carroll died 1898, illustrator Tenniel died 1914) and Huckleberry Finn (1885 edition; Twain died 1910, illustrator E. W. Kemble died 1933). Both original works and these editions predate 1931. No modern translation is used. The script records source links and computes SHA-256. Downloads and their manifest stay gitignored; default catalog behavior is unchanged.

The sample catalog uses test approval/flagged states, not real chain records or curator decisions. Alice's reported Hunan ban has historical uncertainty and is labeled for curator review. P2 must verify content and ban metadata before real ingestion. Samples have not passed the scanner. The sample-only download helper verifies against a local hash, not an on-chain hash; production gateway downloads remain A5's responsibility.

With the dev server running, run `npx playwright install chromium`, then `npx playwright test` for browser checks of search, country filtering, actual downloads, hash mismatch rejection, and mobile overflow. Run `npm test` for unit tests.
