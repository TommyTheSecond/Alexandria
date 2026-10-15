# Contract operations (Fuji / Anvil only)

Use Node 20, Foundry and Soldeer. Run commands from `contracts/`. Restore dependencies with `forge soldeer install --config-location foundry`, then run `forge build` and `forge test`.

Copy `contracts/.env.example` to `.env` locally and fill public configuration. `ADMIN` is the deployed 1-of-1 Safe; `CURATORS` is a comma-separated list with P1 first; `RELAYER` is the backend's dedicated testnet address. `RPC_URL` selects Fuji or local Anvil. Set `DEPLOYER` to your local keystore account name, not a private key.

For P1's verified Fuji setup:

- ADMIN: `0x18189bC3d8A59f75924f47d845c9DdeA283629A1`
- First CURATORS entry: `0xc0c64B0B12e4638Aa74F6125eEE5930d99E6401B`
- Deployer address: `0x37295780F2c089D97DD240916F1a841A2db3a4C2`
- DEPLOYER keystore account: `alexandria-deployer-v2`
- RELAYER: `0x96e0C244bfC50EA0F4DEcA75df1455E2FA734EE3`
- Relayer keystore account: `alexandria-relayer`
- RPC_URL: `https://api.avax-test.network/ext/bc/C/rpc`

P1 created the replacement operational accounts above directly in local encrypted Foundry keystores. They replace the earlier Core operational addresses; the admin Safe and curator remain unchanged. Verify local unlocks with `cast wallet address --account alexandria-deployer-v2` and `cast wallet address --account alexandria-relayer`, and check that the output matches these addresses before funding or signing. The older `alexandria-deployer` keystore has an unknown password and must not be used. Keep all passwords and signing material local; never pass `--private-key` or commit secrets. All Fuji broadcasts require P1's authorization.

## Deploy and record

First simulate, then broadcast only after P1 approves:

```sh
forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --account "$DEPLOYER"
forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --account "$DEPLOYER" --broadcast
forge script script/RecordDeployment.s.sol --rpc-url "$RPC_URL"
```

On Fuji, Deploy requires an already deployed Safe whose only owner is the first curator and whose threshold is 1. It grants admin directly to that Safe. RecordDeployment is a separate read-only script because the actual transaction hash and mined block are available only after the broadcast finishes. It reads Foundry's confirmed broadcast receipt, checks current roles on the RPC, and writes I7 with `vm.writeJson`. It refuses to overwrite a different existing Fuji deployment record. Commit the resulting `deployments/fuji.json` only after verification; never commit broadcast/cache files.

Verify the source using the current Fuji explorer verifier instructions before declaring deployment complete.

### Confirmed Fuji deployment

P1 deployed `0xeBF13D70A7C2D4EA9891FA6c6d42f065AAB608C9` at block `59493935`, transaction `0xcaefa2f39a5185e586f2cca6f9f6f389665395d78dfaac8d831103bf8984f95e`. The receipt-backed I7 record is `deployments/fuji.json`.

Independent read-only RPC checks matched deployed runtime bytecode exactly to the tested artifact, confirmed the Safe's admin role and sole owner/threshold 1, the deployer's absence of admin, the P1 curator role, the replacement relayer role, `bookCount() == 0`, and open submissions.

Source verification passed on Avalanche Builder Hub with `runtimeMatch: exact_match`, Solidity `0.8.24+commit.e11b9ed9`. The public verification result is available at <https://build.avax.network/api/verify/sourcify/v2/contract/43113/0xeBF13D70A7C2D4EA9891FA6c6d42f065AAB608C9?fields=compilation>. Verification publishes source and does not send an on-chain transaction. The operator used the official Foundry verification flow with chain ID 43113 and verifier URL `https://build.avax.network/api/verify/43113/api`; its API-key parameter is an ignored placeholder, not a credential.

Do not rerun Deploy for this registry. The next integration step is configuring the relayer on the onion host; its dedicated testnet key goes from P1 to P4 privately, never through chat, Git or the public agent board.

## Seed local Anvil

Start `anvil --chain-id 31337`. Set `ANVIL_SENDER` to one of that node's unlocked public addresses and `ANVIL_FLAGGERS` to three distinct unlocked addresses. Set `ADMIN`, `CURATORS` and `RELAYER` to `ANVIL_SENDER` for this local fixture deployment. The default input is A3's `../fixtures/catalog.json`; `FIXTURE_CATALOG` may select a different approved fixture file.

```sh
forge script script/SeedAnvil.s.sol --rpc-url http://127.0.0.1:8545 --unlocked --broadcast
forge script script/RecordDeployment.s.sol --rpc-url http://127.0.0.1:8545
```

This creates three distinct fixture books, approves them, then flags the third from three addresses, leaving two Approved and one Flagged. RecordDeployment writes `deployments/anvil.json` from the actual local deployment receipt. SeedAnvil rejects every chain except 31337 and embeds no private keys.

## Curate

```sh
bash script/curate.sh pending
bash script/curate.sh --account curator approve 1 "Public-domain and ban sources checked"
bash script/curate.sh --account curator reject 2 "Public-domain rule not met"
bash script/curate.sh --account curator snapshot baf... 12345
```

The helper loads `.env` through Node's env-file support, checks the RPC against the deployment record, and restricts operations to Fuji or Anvil. `pending` is read-only. Writes use a local named keystore. On Windows the same helper can be run as `node --env-file=.env script/curate.mjs ...`.

## Fallback admin handover

Normally unnecessary because Deploy assigns admin to the Safe immediately. For a legacy deployer-admin deployment, set `CONTRACT`, `DEPLOYER_ADDRESS` and the same Safe/curator configuration. Simulate and obtain P1 approval before broadcasting `HandOverAdmin.grant()`.

After P1 executes an admin action through the Safe and confirms it succeeded, set `SAFE_TEST_CONFIRMED=true`. Only with P1's separate explicit approval, set `RENOUNCE_CONFIRMED=true` and invoke `HandOverAdmin.renounce()`. The script checks Safe ownership/threshold and its admin role before allowing the irreversible renunciation. Never run both phases blindly in one batch.

## Protocol note: Rejection Permanence (`idBySha256`)

In `Alexandria.sol`, `idBySha256[pdfSha256]` is indexed upon submission (`submit()`) and remains set even if `review(id, false, reason)` sets the status to `Status.Rejected`. Consequently, any future submission of the exact same PDF binary (matching SHA-256) reverts on-chain with `Duplicate(existingId)`.

**Operational Guidance for Curators:**
- Curators should execute on-chain `reject` **only** for books that fundamentally violate the public-domain rule (e.g., author/translator died after 1955 or first publication after 1930).
- If a candidate book has genuine public-domain content but minor metadata inaccuracies, curators should leave it in `Pending` or request metadata review before issuing an irreversible on-chain rejection.

