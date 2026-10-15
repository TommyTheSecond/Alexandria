# Rules for every AI agent on Alexandria

You are one of 6 AI agents (A1–A6) building **Alexandria**, a censorship-resistant library of public-domain banned books on Avalanche Fuji, in a **24-hour hackathon**. Four humans (P1–P4) each run one or two of you. Other agents are editing the same repository right now, so these rules exist to stop you from colliding with them.

## Read first, in this order

1. `README.md`: the whole plan. Sections 4 (ownership), 10 (global constraints) and 11 (review focus) are mandatory.
2. `docs/INTERFACES.md`: the frozen contracts between workstreams.
3. Your own brief: `docs/agents/A<n>-*.md`. Your human tells you which number you are.

If your brief and the README disagree, the README wins. Tell your human about the conflict.

## Hard rules

1. **Edit only the paths your brief says you own.** You may read any file. If you need a change somewhere else, stop. Write the request (file, change, reason) for your human, who opens an issue for the owner.
2. **Never edit a frozen interface:**
   - `contracts/src/IAlexandria.sol`
   - `schemas/*`
   - `packages/sdk/src/types.ts`
   - `docs/INTERFACES.md`

   If one seems wrong, stop and tell your human. Changes need an `rfc` PR approved by all 4 people.
3. **Work in your own git worktree and branch:** `ws<n>/<agent>/<short-task>`, for example `ws3/a5/download-verify`. Never commit to `main`, never force-push a shared branch, never rewrite history others have pulled.
4. **Write the test first.** Write a failing test, make it pass, then commit. Run your workstream's full test command before every PR.
5. **Small PRs.** One task per PR, merged as soon as it is green. Rebase on `main` before opening a PR. Never let a branch live longer than about 3 hours.
6. **Dependencies:** add them only to your own package's manifest. If `pnpm-lock.yaml` conflicts, rebase, run `pnpm install`, and commit the result. Never edit the lockfile by hand.
7. **Secrets:** never write a private key, API key or secret into a file under git, a log line, a test fixture or a message. Read them from `.env` (gitignored). Add each new variable name, with no value, to `.env.example` in your own path.
8. **Testnet only.** Chain ID `43113` (Fuji) or `31337` (Anvil). Never write code or config that targets mainnet.
9. **Privacy:** no analytics, no third-party CDN, fonts or scripts, and no logging of IP addresses or request lines. The only exception is WalletConnect, loaded only after a user clicks "Connect with WalletConnect" (README section 3.4).
10. **Content:** only public-domain books (README section 10). Never add, fetch or generate copyrighted book text, not even for fixtures.
11. **Scraping:** never send automated requests to `gutenberg.org`. Use `pg_catalog.csv`.

## When to stop and ask your human

- You are blocked for more than 20 minutes.
- The task needs a file outside your paths.
- A frozen interface looks wrong or incomplete.
- A test from another workstream fails on `main`.
- You are about to do something irreversible: deploy, send a transaction, delete a branch, unpin content, or rotate a key.

## Commit and PR format

- Conventional Commits: `feat(sdk): verify sha256 before saving pdf`.
- PR title = commit title. The PR body lists:
  - what changed
  - how it was tested (the command and its result)
  - which brief task it completes, e.g. "A5 T3"
- Link the issue, if there is one.

## Definition of done (every task)

- The tests named in your brief exist and pass.
- CI is green.
- No file outside your paths changed.
- No secrets in the diff.
- No `TODO` left in code you were told to finish.
