# Agent brief: A1, Contracts (human: P1)

## Your job

Build and deploy `Alexandria.sol`, the on-chain registry of public-domain banned books on Avalanche Fuji. It records each book's PDF CID, metadata CID and SHA-256 hash, its review status and its flags. It must be simple, have no upgrade proxy and **never delete anything**.

Read `AGENTS.md`, `README.md` (sections 3.3, 4, 10, 11 and 13) and `docs/INTERFACES.md` (I1 and I7) before you start.

## You own (only edit these)

- `contracts/src/` (except `IAlexandria.sol` once G0 passes)
- `contracts/script/`
- `contracts/foundry.toml`, `contracts/dependencies/`, `contracts/remappings.txt`
- `deployments/`

**Never edit:**
- `contracts/test/` (A2 owns it; tell P1 if a test looks wrong)
- frozen interfaces
- anything else

## Inputs

- I1 (`IAlexandria.sol`): your exact external API.
- A2's tests in `contracts/test/`: your acceptance test.
- Addresses from README section 9.4 (P1 gives them to you through `.env`).

## Outputs others depend on

| Output | Needed by | Deadline |
|---|---|---|
| `deployments/abi/IAlexandria.json` | A2, A5, A6 | H+2 |
| `deployments/anvil.json` + `contracts/script/SeedAnvil.s.sol` | A2, A5 | H+7 |
| Contract deployed on Fuji + `deployments/fuji.json` | everyone | **H+7** |

## Tasks

- [ ] **T0 Project setup (H+0 – H+2)**
  - Create the Foundry project in `contracts/`.
  - Install OpenZeppelin Contracts 5.x **with Soldeer**, so nothing changes outside `contracts/`:
    ```bash
    forge soldeer install @openzeppelin-contracts~5.1.0
    ```
    Use any 5.x version the registry lists. Set `solc = "0.8.24"`.
  - Do not create `contracts/src/IAlexandria.sol` yourself. P4 adds it in the `rfc/g0-interfaces` PR (merged by H+1:30). Rebase on `main` after that merge.
  - Generate the ABI:
    ```bash
    forge inspect IAlexandria abi --json > ../deployments/abi/IAlexandria.json
    ```
  - *Done when:* `forge build` passes and the ABI JSON is committed.

- [ ] **T1 Implement `Alexandria.sol` (H+2 – H+6)**
  - Write `contract Alexandria is IAlexandria, AccessControl` with constructor `(address admin, address[] memory curators, address relayer)`. It grants `DEFAULT_ADMIN_ROLE` to `admin`, `CURATOR_ROLE` to each curator and `RELAYER_ROLE` to `relayer`, and sets `submissionsOpen = true`.
  - Constants: `FLAG_THRESHOLD = 3`, `MAX_PENDING_PER_SUBMITTER = 5`, `MAX_CID_BYTES = 100`.
  - State: `Book[]` (or `mapping(uint256 => Book)`), `bookCount`, `idBySha256`, `pendingCount`, `mapping(uint256 => mapping(address => bool)) flaggedBy`, `latestSnapshotCid`, `latestSnapshotBlock`.
  - Follow the state machine in README 3.3 and the NatSpec in I1 **exactly**:
    - Use the custom errors and events I1 names. No `require` strings.
    - Confirmed books count flags but never change status.
    - `Rejected` is final.
    - `review` leaving `Pending` decrements `pendingCount[submitter]`.
  - Not allowed: `selfdestruct`, `delegatecall`, upgrade proxies, a delete function, a pause on reads.
  - *Done when:* all of A2's unit tests pass: `cd contracts && forge test`. Until A2's tests land (H+4), test locally in a scratch file you do **not** commit.

- [ ] **T2 Deploy scripts (H+5 – H+7)**
  - Write `script/Deploy.s.sol`. It reads env `ADMIN`, `CURATORS` (comma-separated), `RELAYER` and `DEPLOYER` (keystore account), deploys, and writes `deployments/<network>.json` in the I7 shape with `vm.writeJson`. Set `fs_permissions` in `foundry.toml` for `../deployments`.
  - Write `script/SeedAnvil.s.sol`. It deploys to Anvil, submits 3 books with fixture data from `fixtures/catalog.json`, approves 2, flags 1 three times, and writes `deployments/anvil.json`.
  - Store the deployer key with `cast wallet import deployer --interactive` and use `--account deployer`. **Never pass `--private-key`**, because it ends up in shell history.
  - Deploy to Fuji **only after P1 says yes**: a deploy is a real transaction.
    ```bash
    forge script script/Deploy.s.sol --rpc-url https://api.avax-test.network/ext/bc/C/rpc --account deployer --broadcast
    ```
  - Verify the source on the Fuji explorer. Check the Avalanche docs for the current verifier URL.
  - *Done when:* `deployments/fuji.json` is committed, `cast call <addr> "bookCount()(uint256)"` returns `0`, and the explorer shows the verified source.

- [ ] **T3 Curator and admin helpers (H+8 – H+11)**
  - `script/curate.sh` wraps `cast send` with `--account <name>`, with these subcommands:
    - `approve <id> <reason>`
    - `reject <id> <reason>`
    - `snapshot <cid> <block>`
    - `pending` (lists Pending ids)
  - `script/HandOverAdmin.s.sol` grants `DEFAULT_ADMIN_ROLE` to the 1-of-1 Safe. Verify that its sole owner is P1's curator wallet and its signature threshold is 1. **Only after** a test call from the Safe succeeds (for example `setSubmissionsOpen(true)`) does it renounce the deployer's admin role. **Renouncing cannot be undone**, so get P1's explicit go-ahead.
  - *Done when:* P1 has approved a test book on Fuji with `curate.sh`, and the verified 1-of-1 Safe holds admin.

- [ ] **T4 Static analysis (H+11 – H+14)**
  - Run `slither contracts/` (`pip install slither-analyzer`). Fix every high finding. Explain each medium finding you leave in the PR body.
  - *Done when:* 0 high findings, and A2 reports ≥ 95% line coverage from `forge coverage`.

- [ ] **T5 Integration support (H+14 – H+20):** fix contract bugs found end to end. **A redeploy after H+14 needs all 4 people's agreement**, because it changes the address everyone uses.

## Gotchas

- Check CID length as `bytes(cid).length`. Empty or > 100 bytes means `InvalidCid()`.
- `getBook(0)` and `getBook(bookCount + 1)` must revert with `UnknownBook`.
- `flag` on `Pending` or `Rejected` reverts with `NotFlaggable`.
- Emit `BookReviewed` with the **new** status.
- Keep strings out of storage loops. Pagination happens off-chain (A5 uses multicall).

## Ask P1 before

Any Fuji transaction, renouncing a role, redeploying, or changing anything in I1.
