# Agent brief: A2, Contract tests + relayer (human: P1)

## Your job

1. Write the tests that define a correct `Alexandria.sol`. A1 implements against them.
2. Build the **relayer**, a small local service. It submits books on-chain for web uploaders who have no wallet.

Read `AGENTS.md`, `README.md` (sections 3, 4, 10, 11 and 13) and `docs/INTERFACES.md` (I1, I6 and I7) before you start.

## You own (only edit these)

- `contracts/test/`
- `relayer/`

**Never edit:**
- `contracts/src/`, `contracts/script/`, `deployments/` (A1 owns them)
- frozen interfaces
- anything else

## Inputs

- I1: the contract spec. Write the tests from I1 and README 3.3, not from A1's code.
- I6: the relayer API you must serve.
- I7: `deployments/fuji.json` and `deployments/anvil.json`.

## Outputs others depend on

| Output | Needed by | Deadline |
|---|---|---|
| Unit tests in `contracts/test/Alexandria.t.sol` | A1 | **H+4** |
| Relayer serving I6 on `127.0.0.1:8787` | A3 | **H+8** |
| Fuzz + invariant tests, coverage report | gate G2 | H+11 |

## Tasks

- [ ] **T1 Unit tests (H+2 – H+4)** in `contracts/test/Alexandria.t.sol`. One test per line below. Use `vm.expectRevert(abi.encodeWithSelector(...))` with the I1 custom errors.
  - `test_Submit_AssignsIdsFromOne`
  - `test_Submit_EmitsBookSubmitted`
  - `test_Submit_RevertsWhenClosed`
  - `test_Submit_RevertsOnEmptyCid`
  - `test_Submit_RevertsOnCidOver100Bytes`
  - `test_Submit_RevertsOnZeroHash`
  - `test_Submit_RevertsOnDuplicate_ReturnsExistingId`
  - `test_Submit_NonRelayerLimitedToFivePending`
  - `test_Submit_RelayerExemptFromPendingLimit`
  - `test_Review_OnlyCurator`
  - `test_Review_ApprovePending`
  - `test_Review_RejectPending`
  - `test_Review_DecrementsPendingCount`
  - `test_Review_RevertsOnApproved`
  - `test_Review_RevertsOnRejected`
  - `test_Flag_OncePerAddress`
  - `test_Flag_RevertsOnPending`
  - `test_Flag_RevertsOnRejected`
  - `test_Flag_ThreeFlagsMakeFlagged`
  - `test_ReviewFlagged_ApproveSetsConfirmed`
  - `test_ReviewFlagged_Reject`
  - `test_Flag_ConfirmedBookStaysApproved` (README Review focus 5: 10 different addresses flag it and the status stays `Approved`)
  - `test_PublishSnapshot_OnlyCurator`
  - `test_PublishSnapshot_StoresLatest`
  - `test_SetSubmissionsOpen_OnlyAdmin`
  - `test_GetBook_RevertsOnZeroAndPastEnd`

  The tests import `../src/Alexandria.sol`, which won't compile until A1 pushes a stub. Agree on that stub with A1 through P1 at H+2.
  *Done when:* the tests compile against A1's stub and fail for the right reasons.

- [ ] **T2 Relayer (H+4 – H+8)** in `relayer/`.
  - **Stack:** Node 20, TypeScript, `viem`, `node:http` (or Hono), `vitest`. Package name `@alexandria/relayer`.
  - **Files:**
    - `src/server.ts`: HTTP routes.
    - `src/chain.ts`: viem clients and the submit function.
    - `src/cap.ts`: daily cap.
    - `src/env.ts`: env parsing.
    - `.env.example`
  - **Env:** `RELAYER_KEYSTORE` (or `RELAYER_PRIVATE_KEY`, testnet only), `RELAY_SECRET`, `RPC_URL`, `DEPLOYMENT=../deployments/fuji.json`, `PORT=8787`.
  - **Behaviour (exactly as I6):**
    - Bind to `127.0.0.1` only.
    - Check `X-Relay-Secret` with `crypto.timingSafeEqual`.
    - Validate the body: CIDs match `^baf[a-z2-7]{20,97}$`; the hash matches `^0x[0-9a-f]{64}$`.
    - Call `idBySha256` first. If it is not 0, return 409.
    - Daily cap: 200 transactions, in memory, reset at 00:00 UTC. Over the cap, return 429.
    - **Send one transaction at a time** (a promise queue), so nonces never collide.
    - Wait for 1 confirmation, then read `id` from the `BookSubmitted` log.
    - On a revert, decode the custom error name and return 502 with it.
  - **Logging:** log only `bookId` and `txHash`. Never log request bodies, headers or IPs.
  - **Tests** (`relayer/test/*.test.ts`) run against Anvil and `SeedAnvil` from A1 (until it exists, deploy from the test setup):
    - `rejects_missing_or_wrong_secret`
    - `rejects_bad_cid_and_bad_hash`
    - `returns_409_on_duplicate`
    - `submits_and_returns_bookId_and_txHash`
    - `serialises_concurrent_requests` (5 parallel calls, 5 distinct ids, no nonce error)
    - `returns_429_after_daily_cap` (inject cap = 2)
    - `listens_on_loopback_only`
  - *Done when:* `pnpm --filter @alexandria/relayer test` passes, and a manual `curl` against Fuji returns a book id. Ask P1 before the first Fuji transaction.

- [ ] **T3 Fuzz + invariants (H+8 – H+11)** in `contracts/test/Alexandria.invariant.t.sol`, with a handler that randomly calls submit, review, flag and setSubmissionsOpen from random actors. Invariants:
  - `bookCount` never decreases.
  - A `Rejected` book never changes status.
  - The sum of `pendingCount` over all submitters equals the number of `Pending` books.
  - Every id in `1..bookCount` has status ≠ `None`.
  - `idBySha256(getBook(i).pdfSha256) == i` for every `i`.
  - A `confirmed` book is never `Flagged`.

  Also fuzz `submitBook` with random CID lengths (0–200) and random hashes.
  *Done when:* `forge test` passes with `[invariant] runs = 256`, and `forge coverage` reports ≥ 95% of lines for `Alexandria.sol`. Post the number in the PR.

- [ ] **T4 Relayer hardening (H+11 – H+14)**
  - `/health` returns the balance and `sentToday`.
  - Print a warning when the balance is below 0.5 AVAX.
  - Exit with a clear message if `DEPLOYMENT` chainId ≠ the RPC's chainId.

- [ ] **T5 Integration (H+14 – H+20):** run the relayer for the end-to-end tests. Watch the balance. Tell P1 when it drops below 1 AVAX.

## Gotchas

- Fuji is chainId `43113`. Use `avalancheFuji` from `viem/chains`.
- Never commit `.env`. Commit only `.env.example`, with empty values.
- If A1's behaviour and I1 disagree, I1 is right. Report it to P1. Do not change your test to match the code.

## Ask P1 before

The first Fuji transaction, and any change that makes the relayer listen beyond `127.0.0.1`.
