# Agent brief: A6, Access paths + ops (human: P4, integration lead)

## Your job

Make Alexandria **reachable** and keep the repo running:

- the repo scaffold and CI;
- the Tor onion mirror;
- the gateway and RPC lists;
- the IPFS and GitHub Pages deploys;
- pin syncing and snapshot publishing;
- the ASCII hero art;
- the reachability report for China, Iran, Russia and the USA.

Read `AGENTS.md`, `README.md` (all of it: P4 is the integration lead) and `docs/INTERFACES.md` (I5 and I7) before you start.

## You own (only edit these)

- `infra/`
- `assets/`
- `.github/`
- Root config: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `.gitignore`, `.editorconfig`
- `docs/reachability.md`

**Never edit:**
- another agent's package
- frozen interfaces
- `README.md` (P4 edits it by hand)

## Outputs others depend on

| Output | Needed by | Deadline |
|---|---|---|
| Scaffold + CI + CODEOWNERS + path check | everyone | **H+0:45** |
| Kubo + Tor + Caddy onion serving a test page | A4, gate G1 | H+5 |
| `infra/gateways.json`, `infra/rpcs.json`, `infra/config/config.json` | A4, A5 | H+6 |
| `assets/art/hero-{100,72,40}.txt` + `hero.alt.txt` | A4 | H+8 |
| Pin sync + snapshot publishing scripts | P1–P4 | H+11 |
| Reader deployed to GitHub Pages + IPFS + onion | demo | H+14 |
| `docs/reachability.md` | gate G3 | H+19 |

## Tasks

- [ ] **T0 Scaffold + CI (H+0 – H+0:45)**
  - A pnpm workspace with `packages/*`, `apps/*` and `relayer`. Create only root files and empty owner folders (`.gitkeep`); each owner creates their own manifest.
  - `.gitignore`: `.env`, `node_modules/`, `dist/`, `contracts/out/`, `contracts/cache/`, `fixtures/out/`, `scanner/data/`, `infra/tor/hs/`, `infra/kubo/`, `*.key`, `*.pem`.
  - `.github/CODEOWNERS` from README 4.2.
  - `.github/workflows/ci.yml` with these jobs:
    - `contracts`: `foundry-rs/foundry-toolchain`, then `forge test` in `contracts/`.
    - `node`: pnpm install, then `pnpm -r test`.
    - `python`: install ClamAV, then `pip install -r scanner/requirements.txt` and `pytest scanner`.
    - `paths`: runs `infra/scripts/check-paths.mjs`.

    A job skips with success while its folder has no manifest yet.
  - `infra/scripts/check-paths.mjs`:
    - Reads the PR branch name `ws<n>/<agent>/…`.
    - Maps the agent to its owned globs (README section 4).
    - Fails if any changed file falls outside them.
    - Every agent may also change `pnpm-lock.yaml`.
    - Branches named `rfc/…` may touch only the frozen interface files and `docs/INTERFACES.md`. Only humans open these branches.
  - **Tests:** `check-paths` unit tests, one allowed and one denied case per agent.

- [ ] **T1 Onion stack (H+2 – H+5)** in `infra/onion/`.
  - **Kubo:** gateway on `127.0.0.1:8080`, API on `127.0.0.1:5001`. **Never expose the API.**
  - **Tor `torrc`:** `HiddenServiceDir infra/tor/hs` (gitignored: it holds the onion's private key, **never commit it**) and `HiddenServicePort 80 127.0.0.1:8088`.
  - **`Caddyfile`** on `:8088`, with **no `log` directive**. Routes:
    - `/ipfs/*` to `127.0.0.1:8080`
    - `/api/*` to `127.0.0.1:8000`
    - `/rpc` reverse-proxied to `https://api.avax-test.network/ext/bc/C/rpc` (set the upstream Host header)
    - everything else: files from `apps/reader/dist`
  - `infra/onion/start.ps1` and `start.sh` start Kubo, the scanner, the relayer reminder, Caddy and Tor, then print the onion address.
  - *Done when:* Tor Browser opens `http://<onion>/` and shows a test page, and `/ipfs/<cid of good.pdf>` downloads.

- [ ] **T2 Lists + runtime config (H+3 – H+6)**
  - `infra/rpcs.json`: the official Fuji RPC plus ≥ 2 free public Fuji RPCs. Check each with `eth_chainId == 0xa869`. Add `"/rpc"` for the onion build.
  - `infra/gateways.json`: P2's Filebase dedicated gateway (from B5), `https://dweb.link`, `https://ipfs.io`, and any others that pass. Check each by fetching `good.pdf`'s CID and comparing SHA-256. **Do not list `cloudflare-ipfs.com`; it was shut down.** Put `""` (same origin) first in the onion config.
  - `infra/config/config.json` (runtime, copied into each deploy):
    ```json
    { "apiBase": "", "onion": "", "siteCid": "" }
    ```
  - `infra/scripts/check-endpoints.mjs` re-checks every RPC and gateway and prints a pass/fail table. Run it at H+14 and H+22.

- [ ] **T3 ASCII hero art (H+5 – H+8)** with `infra/art/generate.py` (Pillow).
  - **Input image:** a public-domain engraving of the Library of Alexandria, for example O. Von Corven's 19th-century engraving from Wikimedia Commons. Check its PD status and record the source in `assets/art/CREDITS.md`.
  - **Input text:** a public-domain banned book's text.
  - **Algorithm, like the typewriter-art reference:**
    1. Resize to `cols` × `rows`, with `rows = round(cols × h/w × 0.5)` for the character aspect ratio.
    2. Convert to grayscale.
    3. Dark pixels take the next letter from the book text, in sequence.
    4. Mid tones take `:` or `.`.
    5. Light pixels become spaces.
  - **Output:** `assets/art/hero-100.txt`, `hero-72.txt` and `hero-40.txt`, plus a one-sentence `hero.alt.txt`.
  - **Tests:** `generate_is_deterministic` and `line_widths_match_cols`.

- [ ] **T4 Pins + snapshots (H+8 – H+11)**
  - `infra/scripts/pin-sync.mjs` uses `@alexandria/sdk` read-only. It makes sure every Pending, Approved and Flagged book's PDF and metadata are pinned on Kubo, and lists Rejected books.
    - **Unpinning (Kubo + Filebase) needs `--apply`.** Dry run is the default.
    - Ask P4 before every `--apply`.
  - `infra/scripts/publish-snapshot.mjs`:
    1. Runs A5's `build-snapshot`.
    2. Adds `snapshots/latest.json` to Kubo and Filebase with `cid-version=1`.
    3. **Prints** the curator command:
       ```bash
       contracts/script/curate.sh snapshot <cid> <block>
       ```
       A curator runs it. A6 holds no curator key.
  - Run both every 15 minutes during H+14 – H+20 (a loop script).

- [ ] **T5 Deploys (H+8 – H+14)**
  - `.github/workflows/pages.yml` builds `apps/reader` and deploys it to GitHub Pages on every push to `main`.
  - `infra/scripts/deploy-ipfs.mjs` builds the reader, adds `apps/reader/dist` to Kubo with `ipfs add -r --cid-version=1` and to Filebase, and prints the site CID and gateway URLs. Put the site CID into `config.json` as `siteCid`.
  - **Clearnet upload API:** `cloudflared tunnel --url http://127.0.0.1:8000` (a free quick tunnel with a new URL every run). After each start, write the URL plus `/api` into the deployed `config.json` as `apiBase`.
  - `infra/scripts/filebase-usage.mjs` prints the bytes used against the 5 GB limit. Warn when usage passes 1 GB.

- [ ] **T6 Reachability report (H+11 – H+19)**
  - **Data source:** the OONI API aggregation endpoint (`https://api.ooni.io/api/v1/aggregation`). Use `test_name=web_connectivity`, `probe_cc` ∈ {CN, IR, RU, US}, and the last 30 days.
  - **Domains:** `ipfs.io`, `dweb.link`, the Filebase gateway domain, `api.avax-test.network`, `github.io`, `torproject.org`. Also include the `tor` test per country.
  - `docs/reachability.md` has one table per country with these columns:
    - domain
    - measurements (count)
    - anomalies (count)
    - confirmed blocks (count)
    - anomaly rate (%) = anomalies ÷ measurements × 100
  - **Also state:**
    - the exact date range;
    - that an OONI anomaly is not the same as a confirmed block;
    - that the probes are volunteer-run, so sample sizes differ;
    - that zero measurements means **unknown**, not reachable.
  - Script: `infra/ooni/report.mjs`, so the numbers can be reproduced.

- [ ] **T7 Integration lead support (H+14 – H+24)**
  - Run the onion end to end (H+16 – H+18).
  - Re-check endpoints at H+22.
  - Keep the onion host awake and on power.
  - Help P4 with the demo script.

## Gotchas

- The onion private key in `infra/tor/hs/` **is** the onion address. If it leaks, someone else can impersonate the site.
- Caddy, Kubo and Tor all run on P4's laptop. Turn off sleep during the hackathon.
- The Cloudflare tunnel is clearnet only, and Cloudflare may be blocked in some target countries. The onion `/api` path is the censorship-resistant upload route.

## Ask P4 before

Unpinning anything, exposing any new port, changing branch protection or CI required checks, and every deploy after the H+20 feature freeze.
