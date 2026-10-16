# Alexandria reader

Preact, Vite 5, strict TypeScript. Run `npm install`, then `npm run dev`.

## Current design

- Light cream `#F1E0C5` and black modes, with a saved preference.
- Shaded ASCII title across the masthead.
- The supplied Lady Justice engraving sits in the hero below the masthead, replacing the School of Athens artwork. It is static, including during scrolling; no rotating model is loaded.
- Text controls and open-book catalog icons. Search and country/scope filters work on approved and flagged catalog records.
- All runtime assets are local. Lady Justice uses the unchanged project-owner-supplied `Alexandria.png`, copied to `public/lady-justice.png`; CSS blends its background into each theme.

Build the title with `scripts/build-header.ps1`. Earlier model and painting generators remain in `scripts/` for reference; their artwork is no longer displayed.

## Local sample books

Run `node scripts/prepare-samples.mjs` and open `http://127.0.0.1:5173/?samples=1#/`.

Samples are historical Internet Archive scans of Alice (1890 edition) and Huckleberry Finn (1885 edition), with local SHA-256 verification. Test statuses are not on-chain records or curator approvals. P2 must verify/scan books before ingestion. Alice's reported Hunan ban is labeled as needing historical review. PDFs and the generated sample catalog are gitignored.

Production uses the SDK for live Fuji catalog reads with the bundled snapshot as a fallback, SHA-256-verified IPFS downloads, scanner submission, wallet flagging and curator reviews. The build copies `snapshots/latest.json` into the reader when that file exists. The default catalog remains empty until approved books or a real snapshot are supplied. No shared SDK interfaces are modified.

## Checks

- `npm test`: unit tests.
- `npm run build`: strict TypeScript and production build.
- With the dev server running: `npx playwright install chromium`, then `npx playwright test`.

Browser checks cover static Lady Justice artwork during scrolling, reduced motion, both themes, mobile layout, accessible readable UI, search/filter behavior and verified sample downloads. Decorative ASCII graphics have descriptions; their shading is excluded from text-contrast checks.
## Political demo handoff (2026-10-15)

Open http://127.0.0.1:5173/?collection=political#/ for the presentation. Collection paused at the user's request: 11 historical political scans (about 160 MiB), with search, detail pages, source links and SHA-256-checked PDF downloads. A questionable Cambridge text was excluded because its edition date was unclear. All entries remain local and need source/edition, scanner and curator review; no ban claims or on-chain approvals are implied.

The downloaded PDFs and generated catalog remain gitignored. `scripts/political-demo-sources.json` records the 11 source records for handoff. `scripts/collect-political.mjs` is an optional bulk research tool; do not restart it during the presentation. It targets 50, which has not been completed. These are separate from P2's seed ingestion.

The local political collection remains separate from on-chain books. It is not submitted or approved by the production reader integration.
