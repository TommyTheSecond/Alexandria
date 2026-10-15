# Alexandria

> Named after the Library of Alexandria, which burned. This library is built so it cannot burn.

Alexandria is a censorship-resistant library of **banned books that are in the public domain**. Anyone can find a book, read why and where it was banned, and **download it as a PDF**, with no wallet, no account and no tracking. Anyone can upload a book. An automatic scanner removes spam and junk, and a human curator approves what remains. The book registry lives on **Avalanche** (Fuji testnet). The PDFs live on **IPFS**.

This README is the single source of truth for the 24-hour hackathon. All 4 people and all 6 AI agents work from it.

**Contents**

1. [What we build, and what we do not](#1-what-we-build-and-what-we-do-not)
2. [Locked decisions](#2-locked-decisions)
3. [Architecture](#3-architecture)
4. [Team, agents and ownership](#4-team-agents-and-ownership)
5. [Frozen interfaces](#5-frozen-interfaces)
6. [Spam and junk scanner](#6-spam-and-junk-scanner)
7. [Frontend theme](#7-frontend-theme)
8. [Seed books and U-bot](#8-seed-books-and-u-bot)
9. [Timeline](#9-timeline)
10. [Global constraints](#10-global-constraints)
11. [Review focus](#11-review-focus)
12. [Success criteria](#12-success-criteria)
13. [Security and privacy rules](#13-security-and-privacy-rules)
14. [Risks](#14-risks)
15. [Sources](#15-sources)
16. [Demo script](#16-demo-script-draft-p4)

---

## 1. What we build, and what we do not

**In scope (must ship by H+24):**

- A public catalog of banned books. Each book shows its ban history (country, year, authority, source).
- **PDF download** for every approved book, checked against its SHA-256 hash before saving.
- **Upload for anyone**, through the website (no wallet needed) or directly on-chain (with a wallet).
- An automatic **spam and junk scanner**, plus human curator approval.
- An on-chain registry on **Avalanche Fuji C-Chain**, with a 3-of-4 Safe multisig as admin.
- Several access paths: GitHub Pages, IPFS gateways, a **Tor onion mirror**, and a snapshot catalog that works when no RPC can be reached.
- A typewriter and ASCII art theme that stays easy to read.
- A reachability report for **China, Iran, Russia and the USA**, based on OONI data.

**Not in scope (do not build):**

- Copyrighted books. Only books that pass the public-domain rule in [section 10](#10-global-constraints).
- Mainnet deployment, tokens, payments or NFTs.
- User accounts, comments or ratings.
- Translations of the UI (but write CSS that works right-to-left later; see [section 7](#7-frontend-theme)).
- An external audit (we have no budget; the README and UI say "unaudited, testnet only").

## 2. Locked decisions

| ID | Decision |
|---|---|
| D1 | Only banned books that are copyright-free (public domain), stored as PDF. |
| D2 | Reachability is measured in China, Iran and Russia (strict internet controls) and the USA (many book bans). |
| D3 | The 3-of-4 Safe multisig (Ash Wallet on Fuji) is the **admin**. It adds or removes curators and can close submissions. **Each of the 4 curators approves books alone**, so approvals are fast. *(Change from plan v0.2: a 3-of-4 vote on every book is too slow for 24 hours. Revert this if the team disagrees.)* |
| D4 | Zero cost. Fuji testnet, free tiers and free software only. |
| D5 | Flags never hide a book. Enough flags mark it "under review", but it stays downloadable. *(Otherwise anyone with many wallets could censor the library.)* |
| D6 | Scanner rejects never reach IPFS or the chain. |

## 3. Architecture

```
                         ┌───────────────────────────────────────────┐
  Reader (browser)       │ Avalanche Fuji C-Chain (chainId 43113)     │
  no wallet needed  ───► │  Alexandria.sol: submit / review / flag    │
        │  read          │  admin = Safe 3-of-4 (Ash Wallet)          │
        │                └───────────────▲───────────────────────────┘
        │ download PDF                   │ submitBook (relayer wallet)
        ▼                                │
  IPFS gateways / own Kubo node     ┌────┴─────┐      ┌─────────────┐
  (sha256 verified in browser) ◄─── │ relayer  │ ◄─── │  scanner    │ ◄── upload (web form)
        ▲                           │ :8787    │      │  :8000      │ ◄── U-bot batch
        │ pin                       └──────────┘      └──────┬──────┘
        └────────────── Filebase (free) + Kubo ◄──────────────┘ pin only if not rejected

  Access paths: GitHub Pages · IPFS (subdomain gateways) · Tor onion (Caddy :8088 serves reader, /ipfs, /api, /rpc)
  Fallback: snapshot catalog (catalog.json on IPFS + bundled in the reader) when no RPC is reachable
```

### 3.1 Read and download flow

1. The reader loads `catalog.json` (snapshot). Then it tries live data from the contract over RPC.
2. If every RPC fails, the reader keeps the snapshot and shows "data as of block N".
3. The user clicks **Download PDF**.
4. The SDK races the IPFS gateways, computes SHA-256 of the bytes and compares it with the on-chain hash.
5. On a match, the browser saves `<title>-<author>.pdf`. On a mismatch, the SDK tries the next gateway. It never saves a file that fails the check.

### 3.2 Upload flow (anyone)

1. The user picks a PDF and fills in the metadata form (title, authors, translators, year, ban records, public-domain source).
2. The browser runs quick checks: PDF type, size ≤ 30 MB, required fields.
3. The browser sends `POST /api/submit` to the scanner.
4. The scanner runs all checks ([section 6](#6-spam-and-junk-scanner)).
   - `reject`: returns HTTP 422 with the report. Nothing is stored.
   - `pass` or `review`: the scanner pins the PDF, metadata and report to Filebase and Kubo, then calls the relayer.
5. The relayer calls `submitBook` with its own wallet. The book is now **Pending**.
6. A curator opens `#/curate`, reads the scan report, and approves or rejects the book.
7. Within ≤ 15 minutes the snapshot is rebuilt and the book appears in the catalog.

A user with a wallet can also call `submitBook` directly. Such books have no scan report, so the curator runs `python -m scanner scan <file>` before approving.

### 3.3 Book states (on-chain)

```
None ──submit──► Pending ──approve──► Approved ──3 flags──► Flagged ──approve──► Approved (confirmed)
                    │                                         │
                    └──reject──► Rejected (final) ◄──reject───┘
```

A confirmed book can still be flagged, but flags no longer change its state.

## 4. Team, agents and ownership

| Workstream | Person | Agent | Owns these paths (only the owner edits them) |
|---|---|---|---|
| WS1 Chain | **P1** | **A1** contracts | `contracts/` except `contracts/test/` and `IAlexandria.sol` (so `src/`, `script/`, `foundry.toml`, `dependencies/`, `remappings.txt`), plus `deployments/` |
| | | **A2** tests + relayer | `contracts/test/`, `relayer/` |
| WS2 Content | **P2** | **A3** scanner + ingest | `scanner/`, `ingest/`, `fixtures/` |
| WS3 Reader | **P3** | **A4** UI | `apps/reader/` |
| | | **A5** SDK | `packages/sdk/` (except `src/types.ts`), `snapshots/` |
| WS4 Access + ops | **P4** (integration lead) | **A6** access + ops | `infra/`, `assets/`, `.github/`, root config files, `docs/reachability.md` |
| Shared, frozen | all 4 | none | `contracts/src/IAlexandria.sol`, `schemas/`, `packages/sdk/src/types.ts`, `docs/INTERFACES.md` |
| Plan | P4 | none | `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/agents/` |

**People:**

| Role | GitHub |
|---|---|
| P1 (chain) | @Saucesandwich |
| P2 (content) | @taminggg1-cmyk |
| P3 (reader) | @raidriarx |
| P4 (access + ops, integration lead) | @TommyTheSecond |

Human-only work (no agent): P2 runs U-bot and checks each book's public-domain status and ban sources. All 4 people approve books as curators.

Agent briefs: [A1](docs/agents/A1-contracts.md) · [A2](docs/agents/A2-tests-relayer.md) · [A3](docs/agents/A3-scanner-ingest.md) · [A4](docs/agents/A4-reader-ui.md) · [A5](docs/agents/A5-sdk.md) · [A6](docs/agents/A6-access-ops.md). Every agent also reads [AGENTS.md](AGENTS.md).

### 4.1 Rules that prevent collisions

1. **One owner per path.** `.github/CODEOWNERS` enforces the table above. CI fails any PR that changes a path its author does not own.
2. **One worktree per agent.** Each agent works on its own branch, named `ws<n>/<agent>/<task>`. Example:
   ```bash
   git worktree add ../alexandria-a1 -b ws1/a1/registry
   ```
3. **Need a change in someone else's path?** Open a GitHub issue that names the owner. Do not edit the file yourself.
4. **Frozen interfaces change only through an RFC.** Open a PR labelled `rfc`. All 4 people must approve it. Bump `schemaVersion`.
5. **Dependencies:** add them only to your own package. If the lockfile conflicts, rebase, run `pnpm install`, and commit the new lockfile. `pnpm-lock.yaml` is the one shared file every agent may commit.
6. **Merging:** each person merges their own agents' PRs after one review by someone outside their workstream. While a person rests, P4 merges for them.
7. **Mocks first.** A4 and A5 build against `fixtures/catalog.json` and a local mock gateway. Nobody waits for the contract.

### 4.2 `.github/CODEOWNERS`

```
*                                   @TommyTheSecond
/contracts/                         @Saucesandwich
/relayer/                           @Saucesandwich
/deployments/                       @Saucesandwich
/scanner/                           @taminggg1-cmyk
/ingest/                            @taminggg1-cmyk
/fixtures/                          @taminggg1-cmyk
/apps/reader/                       @raidriarx
/packages/sdk/                      @raidriarx
/snapshots/                         @raidriarx
/infra/                             @TommyTheSecond
/assets/                            @TommyTheSecond
/.github/                           @TommyTheSecond
/contracts/src/IAlexandria.sol      @Saucesandwich @taminggg1-cmyk @raidriarx @TommyTheSecond
/schemas/                           @Saucesandwich @taminggg1-cmyk @raidriarx @TommyTheSecond
/packages/sdk/src/types.ts          @Saucesandwich @taminggg1-cmyk @raidriarx @TommyTheSecond
/docs/INTERFACES.md                 @Saucesandwich @taminggg1-cmyk @raidriarx @TommyTheSecond
```

In CODEOWNERS the last matching line wins, so the frozen-file lines must stay at the bottom.

## 5. Frozen interfaces

The full text is in [docs/INTERFACES.md](docs/INTERFACES.md). They are frozen at **H+2 (gate G0)**.

**How the freeze works:**
1. At H+0:45, P4 (a human, not an agent) opens the branch `rfc/g0-interfaces`.
2. P4 copies I1–I4 **verbatim** into their real files.
3. All 4 people review the branch, and P4 merges it by H+1:30.
4. After the merge, A1 generates the ABI JSON in its own branch.

| ID | File | Used by |
|---|---|---|
| I1 | `contracts/src/IAlexandria.sol` | A1, A2, A5 |
| I2 | `schemas/book.schema.json` | A3, A4, A5 |
| I3 | `schemas/scan-report.schema.json` | A3, A4, A5 |
| I4 | `packages/sdk/src/types.ts` | A4, A5 |
| I5 | Scanner HTTP API (`/api/*`) | A3, A5, A6 |
| I6 | Relayer HTTP API (`/relay`) | A2, A3 |
| I7 | `deployments/fuji.json` + `deployments/abi/IAlexandria.json` | A1 writes; A2, A5, A6 read |

### Ports (local)

| Port | Service | Exposed? |
|---|---|---|
| 5173 | reader dev server | local only |
| 8000 | scanner | via Caddy (onion) and a Cloudflare quick tunnel (clearnet) |
| 8787 | relayer | **never** (127.0.0.1 only) |
| 8080 | Kubo gateway | via Caddy `/ipfs/` |
| 5001 | Kubo API | **never** |
| 8088 | Caddy | Tor onion service target |

## 6. Spam and junk scanner

Every upload, from the web or from U-bot, goes through the same scanner. A3 owns it.

| Check ID | Rule | Fail result |
|---|---|---|
| `pdf.magic` | File starts with `%PDF-` | reject |
| `pdf.size` | ≤ 31,457,280 bytes (30 MB) | reject |
| `pdf.parse` | Opens with pikepdf, not encrypted, ≥ 10 pages | reject |
| `pdf.active` | No `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile(s)`, `/RichMedia`, `/XFA`, `/AA`, or `/OpenAction` with an action. Walk **every object**, not a regex on raw bytes. | reject |
| `av.clamav` | ClamAV reports the file clean | reject |
| `dup.sha256` | `idBySha256(hash) == 0` on-chain | reject (HTTP 409) |
| `dup.text` | MinHash Jaccard similarity < 0.9 against approved books | review |
| `meta.schema` | Metadata is valid against `book.schema.json` | reject |
| `pd.rule` | `firstPublishedYear ≤ 1930` and every author and translator has `deathYear ≤ 1955` | reject if the years break the rule; review if a year is unknown |
| `pd.source` | `publicDomain.sourceUrl` host is on the allowlist | review |
| `ban.source` | ≥ 1 ban record with an `https://` source URL | reject |
| `text.extract` | ≥ 2,000 words extracted (PyMuPDF) | review (it may be a scan without OCR) |
| `text.match` | Title words and author surname appear in the first 10 pages | review |
| `spam.urls` | < 1 URL per 500 words | review |
| `spam.repeat` | zlib ratio (compressed ÷ original) ≥ 0.20 and unique-word ratio ≥ 0.05 | review |
| `spam.keywords` | < 3 hits from `scanner/blocklist.txt` (casino, airdrop, "click here", …) | review |

**Verdict:** any failed reject-level check gives `reject`. Otherwise, any failed review-level check gives `review`. Otherwise `pass`. **Score** (0–100) = 100 − 15 × (failed review-level checks), floored at 0; it only sorts the curator queue. A curator approves every book, even one marked `pass`.

**Limits on the upload API:** 5 submits per hour per IP and 200 per day in total (counters in memory only, keyed by IP hashed with a daily salt). The relayer also stops after 200 transactions per day.

## 7. Frontend theme

The theme comes from two references: **typewriter art** (pictures made of typed letters on cream paper) and **electric-blue CRT scanlines**.

**Two modes.** The default follows `prefers-color-scheme`, and a toggle remembers the choice in `localStorage` (wrapped in try/catch).

| Token | Paper (light) | Terminal (dark) |
|---|---|---|
| `--bg` | `#F3EBD8` cream paper | `#1010D8` electric blue |
| `--ink` | `#1C1A16` | `#F3EBD8` |
| `--ink-soft` | `#4A453C` | `#C9C6F5` |
| `--accent` | `#1414E6` | `#FFFFFF` |
| `--rule` | `#1C1A16` at 20% | `#F3EBD8` at 30% |

Estimated contrast for main text: about 14:1 (paper) and about 8.5:1 (terminal). Both pass WCAG AA. A4 must confirm every pair with a contrast checker.

**Fonts** (self-hosted WOFF2 in `apps/reader/public/fonts/`, never loaded from Google):

- Headings: **Special Elite** (Apache 2.0), a typewriter face.
- UI and body: **Courier Prime** (OFL), a monospace face built for readability.

**Hero art.** An ASCII picture of the Library of Alexandria, **made of the text of the banned books themselves**, like the reference art. A6 makes it with `infra/art/generate.py`: a public-domain engraving goes in, characters from a public-domain banned book's text come out. Output widths are 100, 72 and 40 columns, one per screen size.

**Rules that keep it readable:**

- ASCII art is decoration. Wrap it in `<pre aria-hidden="true">` with a visually hidden text description next to it.
- Scanlines (`repeating-linear-gradient`) go on the hero art only, never over text.
- Typewriter text animation: headings only, ≤ 1.5 s, turned off under `prefers-reduced-motion`.
- Body text ≥ 16px, line-height ≥ 1.5, measure ≤ 72ch.
- Every action works by keyboard, with a visible focus ring.
- Use CSS logical properties (`margin-inline`, `padding-block`) so a Farsi right-to-left UI works later.
- Book cards use box-drawing borders (`┌─┐`) and show ban countries as plain text (`US · RU · CN`), not flag emoji.

**Pages** (hash routing: `#/`, `#/book/<id>`, `#/upload`, `#/curate`, `#/about`):

- `#/`: hero, search box, filter by country and by ban scope, book cards.
- `#/book/<id>`: title, authors, years, ban timeline, **Download PDF** button (shows size and verifies the hash), on-chain record with a Snowtrace testnet link, "under review" label if flagged, Flag button. The Flag button asks for a wallet only when someone clicks it.
- `#/upload`: form, client checks, scan report shown after submit. No wallet needed.
- `#/curate`: wallet connect, pending queue sorted by score, approve and reject buttons.
- `#/about`: mission, the public-domain rule, the access paths (onion address, gateways), and an "unaudited, testnet only" notice.

Wallets are only ever needed to flag or curate. Browsing, reading, downloading and uploading never ask for one.

## 8. Seed books and U-bot

### 8.1 Rules for every book

- It passes the public-domain rule in [section 10](#10-global-constraints). **Translators count too**: an old book in a modern translation is not public domain.
- Use the original public-domain text. Do not use a modern edition with a new introduction or notes, because those are copyrighted.
- Each ban record needs a source URL. Store facts only. Do not copy Wikipedia prose (CC BY-SA).
- Source: Project Gutenberg EPUB, converted with Calibre. Keep the Project Gutenberg header and license **fully intact** inside the PDF.
- Convert with:
  ```bash
  ebook-convert book.epub book.pdf --paper-size a5 --pdf-default-font-size 14
  ```

### 8.2 Candidate list (P2 checks every line before upload)

| Book | Author (died) | First published | Ban claim to check |
|---|---|---|---|
| Adventures of Huckleberry Finn | Mark Twain (1910) | 1884 | US: Concord Public Library, 1885 |
| Ulysses | James Joyce (1941) | 1922 | US: customs ban until 1933 |
| Lady Chatterley's Lover | D. H. Lawrence (1930) | 1928 | US and UK obscenity bans |
| Candide | Voltaire (1778) | 1759 | US customs seizure, about 1929–1930 |
| Uncle Tom's Cabin | Harriet Beecher Stowe (1896) | 1852 | Russia, under Nicholas I |
| The Kreutzer Sonata | Leo Tolstoy (1910) | 1889 | Russia: censored; US: Post Office, 1890 |
| Alice's Adventures in Wonderland | Lewis Carroll (1898) | 1865 | China: Hunan province, 1931 |
| Leaves of Grass | Walt Whitman (1892) | 1855 | US: Boston, 1882 |
| Hong Lou Meng (Dream of the Red Chamber), Joly translation | Cao Xueqin; translator H. B. Joly (check death year) | about 1791 (translation 1892) | China: Qing dynasty bans |
| Madame Bovary | Gustave Flaubert (1880) | 1857 | Catholic Index of Forbidden Books, 1864 |
| Frankenstein | Mary Shelley (1851) | 1818 | South Africa, 1955 |
| The Call of the Wild | Jack London (1916) | 1903 | Italy and Yugoslavia, 1929 |

Check the translator for every translated book (Tolstoy, Voltaire, Flaubert, Cao Xueqin). **Iran:** this list has no confirmed Iranian ban that also passes the rule, so Iran is covered by the reachability report, not by ban records.

### 8.3 U-bot

**Correction (kickoff):** U-Bot is **u.bot** (https://u.bot/), the AI assistant of the u-topia ecosystem and a hackathon sponsor, not UBot Studio. It is not a scraper, so P2 fills the CSV by hand (step 4), and may use U-Bot to help research candidates. **U-Bot integration is 5% of the judging score** (see 9.0); how Alexandria uses it in the product is an open decision for the team.

1. P2 (with U-Bot or by hand) collects candidate banned books and writes `ingest/candidates.csv` with these columns:
   `title,author,first_published_year,ban_country,ban_year,ban_authority,ban_scope,ban_source_url`
2. **Scraping rules:**
   - Prefer the MediaWiki API for Wikipedia lists.
   - Obey `robots.txt`.
   - Wait at least 1 second between requests.
   - **Never crawl gutenberg.org.** Its policy forbids robots. Use the offline catalogue `pg_catalog.csv` instead.
3. A3's `ingest/match_pg.py` matches the candidates against `pg_catalog.csv`, applies the public-domain rule, and writes `ingest/shortlist.csv`.
4. **Fallback:** P2 fills in `ingest/candidates.csv` by hand from the table in 8.2.
5. P2 downloads the EPUBs by hand, converts them to PDF, and writes one metadata JSON per book.
6. Run `python -m ingest.submit_batch ingest/books/`. This sends each book through `POST /api/submit` with `submittedVia: "ubot"`, so U-bot books get the same scan as user uploads.

## 9. Timeline

`H+n` means n hours after the hackathon starts. **H+0 = Thu 15 Oct 2026, 11:30 ICT (UTC+7).**

### 9.0 Hackathon facts (U-Hackathon, Flow Summit, Avani Sukhumvit Bangkok)

Source: the organisers' information sheet and opening deck. All times ICT.

| What | When / rule |
|---|---|
| Build | Thu 15 Oct 11:30 (H+0) to **Fri 16 Oct 14:00 (H+26:30)**. Submissions close at 14:00 and can be updated until then. |
| Hall | Thu closes 18:00 (H+6:30), Fri opens 10:00 (H+22:30). **No staying overnight**, so night work and the onion host run from home. |
| Mentors | Office hours Thu 13:00–18:00, book at mentor-consultations.vercel.app |
| Team | 1–4 people. Register on hub.team1.network on 15 Oct; organisers must approve the team before it can submit. |
| Track | **Web3** (build anything deployable on-chain). |
| Rules | AI tools allowed. **New builds only**: pre-research and planning were allowed before H+0; all code is written during the build. Teams keep IP; respect third-party licences. |
| Submit | Public GitHub repo · demo website showing the **real product**, not a landing page · pitch deck link set to "Anyone with the link can view". Judges score exactly the submitted version. |
| After | Fri 17:00 finalists (top 3 per track) · 20:00 live demos · 22:00 awards (judges + U-Center DAO vote). |

**Judging:** App execution 40% (core features fully working, not mocked; no crashes) · Practicality 40% (clear user, real problem, deployable) · Usability & design 10% · Innovation & ecosystem 5% (meaningful use of a partner: Avalanche, Tokenomist or ElevenLabs) · U-Bot integration 5%.

### 9.1 BEFORE WORK CAN START (blockers)

Nothing in 9.2 can begin until these are done. **⛔ marks a hard blocker.**

| # | Task | Owner | Blocks |
|---|---|---|---|
| ✅ B1 | Read the hackathon rules. **Done** (see 9.0): AI tools allowed; new builds only, so code starts at H+0; Web3 track; repo must be public. | P4 | everything |
| ⛔ B2 | Each person creates a **new, testnet-only** EVM wallet (Core or MetaMask) and adds Fuji (chainId `43113`, RPC `https://api.avax-test.network/ext/bc/C/rpc`). Also create a deployer wallet (P1) and a relayer wallet (P2). That makes 6 addresses; write them in 9.4. | all | B3, B4 |
| ⛔ B3 | Get test AVAX for all 6 addresses. Try the Builder Hub faucet first, then the Core faucet, then the QuickNode faucet. **Some faucets require a mainnet balance or a coupon.** If all fail, ask the hackathon organisers or Avalanche developer relations for a coupon. | P1 | deploy, Safe, relayer |
| ⛔ B4 | Create the 3-of-4 Safe on Fuji at `wallet.ash.center` with the 4 curator wallets as owners. *Fallback:* the deployer holds admin until the Safe exists, then transfers it before the demo. | P1 | admin handover |
| ⛔ B5 | Create a free Filebase account, an IPFS bucket and an S3 access key. Store the key in a password manager and share it with P4. Never paste it into chat or git. | P2 | scanner pinning |
| ⛔ B6 | Install the tools for your role (versions in [section 10](#10-global-constraints)):<br>• **All:** Git, Node 20 + pnpm 9, your AI agent.<br>• **P1:** Foundry (on Windows, use WSL2).<br>• **P2:** Python 3.11+, ClamAV, Calibre.<br>• **P4:** Kubo, Tor, Caddy, cloudflared.<br>• **P3:** Chrome, Playwright. | all | own workstream |
| B8 | U-Bot is the u.bot assistant, not a scraper (8.3). P2 fills `ingest/candidates.csv` by hand. | P2 | seed books |
| B9 | Verify public-domain status and ban sources for ≥ 12 candidate books. This is research, not code, so it is normally allowed before the start. | P2 | bulk load |
| B10 | Everyone reads this README, AGENTS.md and their own agent brief(s). | all | G0 |

### 9.2 Hour by hour

| Hours | Phase | P1 / A1, A2 | P2 / A3 | P3 / A4, A5 | P4 / A6 |
|---|---|---|---|---|---|
| H+0 – H+2 | **P0 Freeze** | Review I1, I6, I7; A1 Foundry setup, then ABI JSON after the freeze PR | Review I2, I3, I5; A3 makes fixtures | Review I4 | A6 scaffold + CI + CODEOWNERS (merged by H+0:45); P4 opens and merges `rfc/g0-interfaces` (H+0:45 – H+1:30) |
| **H+2** | **Gate G0** | All 4 sign off: interfaces merged, CI runs, fixtures exist | | | |
| H+2 – H+8 | P1 Build A | A2 unit tests (H+2–H+4), then relayer; A1 contract to pass tests, **deploy to Fuji by H+7** | A3 checks + `/api/scan`; P2 runs U-bot and converts PDFs | A4 theme + layout + catalog from fixtures; A5 read path + `downloadPdf` | A6 Kubo + Tor + Caddy onion up by H+5; hero art; gateway and RPC lists |
| **H+8** | **Gate G1** | Contract live on Fuji; `/api/scan` works on fixtures; reader shows the fixture catalog; onion serves a page | | | |
| H+8 – H+14 | P1 Build B | A1 curator scripts + Slither fixes; A2 fuzz and invariant tests, relayer caps | A3 `/api/submit` + pinning + relaying, ClamAV, near-duplicate check, `ingest/` | A4 book page, download, upload, curate, about; A5 `submit()`, snapshot builder, tx lookup | A6 pin-sync, snapshot publishing, GitHub Pages + IPFS deploy, OONI data pull |
| **H+14** | **Gate G2** | Every workstream feature-complete against its brief; CI green | | | |
| H+14 – H+20 | P2 Integrate | End-to-end on Fuji: H+14–H+16 clearnet, H+16–H+18 onion; H+15–H+19 load ≥ 10 books and curators approve them; H+18–H+20 bug fixes, Slither, axe, `docs/reachability.md` | | | |
| **H+20** | **Gate G3, feature freeze** | End-to-end passes on both paths; success criteria 1–10 met. After this, bug fixes only. | | | |
| H+20 – H+22 | P3 Demo | P1 checks the on-chain record | P2 demo data | P3 screenshots + video | P4 final README + demo script |
| H+22 – H+23 | Rehearse | Two full demo runs: one in a clean Chrome profile, one in Tor Browser on the onion | | | |
| H+23 – H+23:30 | **Submit** | P4 submits on hub.team1.network (repo, demo site, deck). The hard deadline is H+26:30 (Fri 14:00); the extra 3 hours are buffer. | | | |
| H+23:30 – H+24 | Buffer | | | | |

### 9.3 Rest rota (suggested)

Only one person rests at a time. Their agents keep working only on tasks with tests already written, and P4 merges for them.

| Window | Rests | Covered by |
|---|---|---|
| H+5 – H+8 | P4 | P1 |
| H+8 – H+11 | P1 | P4 |
| H+11 – H+14 | P2 | P4 |
| H+14 – H+17 | P3 | P4 |

Nobody rests during H+0–H+2, H+17–H+24, or a gate.

### 9.4 Addresses (fill in at B2)

| Role | Person | Fuji address |
|---|---|---|
| Curator 1 / Safe owner | P1 | |
| Curator 2 / Safe owner | P2 | |
| Curator 3 / Safe owner | P3 | |
| Curator 4 / Safe owner | P4 | |
| Deployer | P1 | |
| Relayer | P2 | |
| Safe (3-of-4) | n/a | |
| Alexandria contract | n/a | (from `deployments/fuji.json`) |

## 10. Global constraints

Every task must meet all of these.

- **Network:** Avalanche Fuji C-Chain only, chainId `43113`. No mainnet. Never use a key that has ever held real funds.
- **Public-domain rule (2026):**
  - `firstPublishedYear ≤ 1930` (the US 95-year term), **and**
  - every author **and translator** has `deathYear ≤ 1955` (the EU life + 70 term).
  - An unknown year sends the book to curator review.
  - This is an engineering rule, not legal advice.
- **Public-domain source allowlist:** `gutenberg.org`, `archive.org`, `wikisource.org`, `hathitrust.org`.
- **Files:** PDF only, ≤ 31,457,280 bytes (30 MB).
- **Hash format:** lowercase hex with a `0x` prefix and 64 hex digits, everywhere (chain, JSON, TypeScript, Python).
- **CIDs:** CIDv1, base32 (`bafy…` or `bafk…`), at most 100 characters.
- **Versions:**
  - Solidity `0.8.24`, OpenZeppelin Contracts `5.x`, Foundry (latest stable)
  - Node `20` LTS, pnpm `9`, TypeScript `strict: true`
  - Python `3.11+`
- **No third-party CDN, font, analytics or tracking** at runtime. Self-host every asset, because CDNs are often blocked in the target countries.
- **No IP or request logging anywhere:** scanner, relayer and Caddy.
- **Reading and downloading never need a wallet.**
- **Hosting from any path:** hash routing (`#/…`) and relative asset paths (Vite `base: './'`), so the reader runs from any IPFS gateway path or the onion.
- **Accessibility:** WCAG 2.2 AA; body text ≥ 16px; line-height ≥ 1.5; line length ≤ 72ch.
- **Secrets:** only in `.env` (gitignored). `.env.example` lists the names with no values.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

## 11. Review focus

These are the five failure modes most likely to hurt a real user. Each has an owner who must write a test for it.

1. **A gateway returns HTTP 200 with an HTML error page or a cut-off file.** The download must fail the hash check, try the next gateway, and never save the bad file. (A5)
2. **The title or author is in Chinese, Russian or Farsi.** The page must show it correctly, and the downloaded file name must work, falling back to `book-<id>.pdf`. (A5 file name, A4 display)
3. **A valid-looking PDF hides JavaScript inside an incremental update or an object stream.** The scanner must reject it, because the check walks every object. (A3)
4. **No RPC is reachable** (onion users, or censored networks). The catalog must load from the snapshot and say "data as of block N". (A5 logic, A4 notice)
5. **Many wallets flag one book.** The book stays visible and downloadable with an "under review" label. (A1 contract test, A4 UI)

## 12. Success criteria

Each criterion names its metric and unit, and is checked at gate G3.

| # | Metric | Target |
|---|---|---|
| 1 | Approved books on Fuji (count of books) | ≥ 10 |
| 2 | Distinct ban countries in approved books (count of ISO codes) | ≥ 3 |
| 3 | Download integrity in end-to-end tests (verified ÷ attempted downloads) | 100% |
| 4 | Scanner on the bad-file test set (rejected ÷ files that should be rejected, test set ≥ 10 files) | 100% |
| 5 | Contract line coverage (`forge coverage`, % of lines) | ≥ 95% |
| 6 | Slither high-severity findings (count) | 0 |
| 7 | axe-core serious + critical violations on the 5 pages (count) | 0 |
| 8 | Reader JS bundle without lazy-loaded parts (KB, gzip) | ≤ 150 |
| 9 | Catalog first render under Chrome "Fast 3G" throttling (seconds) | ≤ 5 |
| 10 | `docs/reachability.md` exists. Per domain and per country: OONI anomaly rate (%) = anomalous ÷ total `web_connectivity` measurements, plus raw counts and the date range. | done |

## 13. Security and privacy rules

- **Use testnet keys only.** The relayer and deployer keys are hot keys in `.env` files. Anyone who reads the file controls them. Never reuse these keys, and never put real funds in them.
- **Treat every uploaded PDF as hostile.** Parse it in a subprocess with a 60-second timeout and a 1 GB memory limit, inside WSL2 or Docker, never on the host as a user with access to secrets.
- **Never print secrets.** No API key or private key in logs, chat, screenshots, the demo video or git history. If a key leaks, rotate it at once.
- **No IP logs.** Run uvicorn with `--no-access-log`. Give Caddy no `log` directive.
- **CORS:** `/api/*` allows `*` origins with no credentials, because the reader runs on many origins.
- **Reader privacy:** no analytics, no third-party requests. Downloads go straight from a gateway into the browser.
- **The relayer listens on 127.0.0.1 only** and needs the `X-Relay-Secret` header.

## 14. Risks

| Risk | What we do |
|---|---|
| No faucet gives test AVAX without a mainnet balance | Settle it at B3, before H+0. Ask the organisers for a coupon. |
| Seed books take too long to prepare by hand | Start B9 research early; 10 books is the target, not more. |
| The Safe cannot be created on Fuji | The deployer keeps admin, and we explain this in the demo. |
| A malicious PDF exploits the PDF parser | Subprocess sandbox, time and memory limits, no secrets in the parser process. |
| Spam drains the relayer's test AVAX | Rate limits, the 200-per-day relayer cap, and `setSubmissionsOpen(false)` through the Safe. |
| Public RPC limits or blocks us | Several RPCs, the onion `/rpc` proxy, the snapshot fallback. |
| The onion host laptop sleeps or goes offline | Turn off sleep, keep it on power, and test the onion again at H+22. |
| A book turns out not to be public domain | Curators reject it. Filebase and Kubo unpin it. The on-chain record stays, but the file is gone. |
| Free-tier quota runs out (Filebase 5 GB) | Keep the corpus under 1 GB. A6 monitors usage. |

## 15. Sources

- Avalanche: [C-Chain or L1](https://build.avax.network/docs/dapps/c-chain-or-avalanche-l1), [Etna changes](https://academy.avax.network/guide/etna-changes), [Fuji workflow (RPC, chainId)](https://docs.avax.network/build/dapp/fuji-workflow)
- Safe on Fuji: [Avalanche Academy: Safe/Ash wallet](https://build.avax.network/academy/avalanche-l1/permissioned-l1s/06-multisig-setup/03-create-safe-wallet)
- Storage: [Filebase free tier](https://filebase.com/free/), [Pinata free tier](https://agentdeals.dev/vendor/pinata-ipfs), [ar.io upload docs](https://docs.ar.io/build/upload/)
- Project Gutenberg: [Offline catalogs](https://www.gutenberg.org/ebooks/offline_catalogs), [Linking policy](https://www.gutenberg.org/policy/linking.html)
- Censorship: [GreatFire ipfs.io test](https://en.greatfire.org/https/gateway.ipfs.io/ipfs/bafybeifx7yeb55armcsxwwitkymga5xf53dxiarykms3ygqic223w5sk3m), [IPFS blocked by the Great Firewall](https://discuss.ipfs.tech/t/ipfs-and-kubo-have-been-blocked-by-china-gfw/19969), [OONI Explorer](https://explorer.ooni.org/)
- U-Hackathon: [information sheet](https://docs.google.com/spreadsheets/d/1551A03HTawH4JUsVmK_TxwPAoPz2fhmhy7hkRdC_ao4/htmlview), [opening deck](https://u-hackathon-2026.vercel.app/), [U-Bot](https://u.bot/)

## 16. Demo script (draft, P4)

Live demos are on Fri 16 Oct at 20:00, if we make the top 3 of the Web3 track. Judges score **execution 40%, practicality 40%,
usability 10%, partners 5%, U-Bot 5%** (see 9.0), so show working features on real infrastructure, not slides. Target: 3 minutes. Rehearse it twice (9.2).

| Time | Show | Say (one line) |
|---|---|---|
| 0:00 | Hero art on GitHub Pages | "The Library of Alexandria burned. This one is built so it cannot." |
| 0:15 | Catalog, search, a book's ban timeline (`US · RU · CN`) | "Banned books, public domain only, each with sourced ban records." **User:** a reader in a censored country, or a student whose school pulled the book. |
| 0:40 | **Download PDF**: progress, then saved file | "The browser checks every byte against the SHA-256 stored on Avalanche. A gateway that sends a damaged copy is skipped; nothing bad is ever saved." |
| 1:00 | Same book in **Tor Browser** on the onion | "If the website, the gateways and the RPCs are all blocked, the onion mirror still serves the catalog, the PDFs and the chain." Use `docs/reachability.md`: Tor is ~97% interfered with in CN and RU, so use Snowflake bridges. |
| 1:25 | Upload a junk PDF, then a real public-domain PDF, no wallet | "Anyone can upload without a wallet. The scanner rejects junk and hidden JavaScript before anything is stored; a clean book goes on chain through our relayer." Show the scan report, then the Pending tx on Snowtrace. |
| 2:00 | `#/curate`: a curator approves it | "A human curator approves every book. Approved books appear in the catalog and the next snapshot." |
| 2:20 | A book flagged by 3 wallets | "Flags never hide a book. It says 'under review' and stays downloadable, so nobody can censor it with sock puppets." |
| 2:40 | Architecture slide (README 3) | "Registry on Avalanche Fuji with a Safe as admin, files on IPFS + Filebase, four access paths." U-Bot: **TBD** (team decision). |
| 2:55 | Close | "Unaudited, testnet only, and it works today." |

**Before going on stage** (P4 checks, H+22):

- [ ] Onion host awake and on power; `infra/onion/start.sh` shows kubo, scanner, relayer, caddy and the onion address.
- [ ] `infra/scripts/sync-loop.sh` running; the newest snapshot recorded on chain (`curate.sh snapshot …`).
- [ ] `node infra/scripts/check-endpoints.mjs` all PASS; tunnel URL set as repo variable `API_BASE` and Pages redeployed.
- [ ] Tor Browser (with Snowflake) has the onion open; a clean Chrome profile has GitHub Pages open.
- [ ] Junk PDF and a fresh public-domain PDF ready on the desktop; a curator wallet unlocked on Fuji; 3 flagger wallets funded.
- [ ] Fallback: a screen recording of the full run, in case the venue Wi-Fi fails.
