# Contract operations (Fuji / Anvil only)

Use Node 20, Foundry and Soldeer. Run commands from `contracts/`. Restore dependencies with `forge soldeer install --config-location foundry`, then run `forge build` and `forge test`.

Copy `contracts/.env.example` to `.env` locally and fill public configuration. `ADMIN` is the deployed 1-of-1 Safe; `CURATORS` is a comma-separated list with P1 first; `RELAYER` is the backend's dedicated testnet address. `RPC_URL` selects Fuji or local Anvil. Set `DEPLOYER` to your local keystore account name, not a private key.

For P1's verified Fuji setup:

- ADMIN: `0x18189bC3d8A59f75924f47d845c9DdeA283629A1`
- First CURATORS entry: `0xc0c64B0B12e4638Aa74F6125eEE5930d99E6401B`
- RPC_URL: `https://api.avax-test.network/ext/bc/C/rpc`

The separate relayer/deployer addresses still need to be supplied by P1/P2. Store the deployer in an encrypted keystore with `cast wallet import deployer --interactive`. Enter its dedicated testnet key in the local prompt; never pass `--private-key` or commit signing material. All Fuji broadcasts require P1's authorization.

## Deploy and record

First simulate, then broadcast only after P1 approves:

```sh
forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --account "$DEPLOYER"
forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --account "$DEPLOYER" --broadcast
forge script script/RecordDeployment.s.sol --rpc-url "$RPC_URL"
```

On Fuji, Deploy requires an already deployed Safe whose only owner is the first curator and whose threshold is 1. It grants admin directly to that Safe. RecordDeployment is a separate read-only script because the actual transaction hash and mined block are available only after the broadcast finishes. It reads Foundry's confirmed broadcast receipt, checks current roles on the RPC, and writes I7 with `vm.writeJson`. It refuses to overwrite a different existing Fuji deployment record. Commit the resulting `deployments/fuji.json` only after verification; never commit broadcast/cache files.

Verify the source using the current Fuji explorer verifier instructions before declaring deployment complete.

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
