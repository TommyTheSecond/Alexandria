# Alexandria relayer

Internal I6 service for wallet-free web submissions. It binds to `127.0.0.1` only; never expose port 8787 through Caddy or a tunnel. Every request, including health checks, needs `X-Relay-Secret`.

## Run

1. Install the workspace with Node 20 and pnpm 9: `pnpm install`.
2. Copy `.env.example` to `.env` locally. Fill `RELAYER_PRIVATE_KEY` with the dedicated testnet relayer account's key and `RELAY_SECRET` with a random secret of at least 32 characters. Share the relay secret privately with the scanner operator. Never commit either value.
3. Set `RPC_URL` to a Fuji or local Anvil RPC; set `DEPLOYMENT` to `../deployments/fuji.json` or `../deployments/anvil.json`; set `PORT=8787`.
4. From `relayer/`, run `pnpm start`. Startup rejects mainnet, a mismatched RPC network, or an address without deployed code. Keep the relayer funded with test AVAX.

`GET /health` returns address, balanceWei and sentToday. `POST /relay` accepts exactly pdfCid, metaCid and pdfSha256, following I6. Both CIDs must be CIDv1 base32 and the digest must be lowercase 0x-prefixed SHA-256.

Duplicate lookup, daily-budget reservation and submission share one promise queue, avoiding nonce and duplicate races. Each transaction waits for one confirmation. The in-memory budget resets at 00:00 UTC and caps attempts at 200 per day. Failed broadcast attempts conservatively consume a slot because a transaction might already have been sent. Restarting the process resets these in-memory counters.

Only successful bookId/txHash pairs are logged. RPC request details, headers, signing material, bodies and IP addresses are never logged. The server returns sanitized contract error names or a generic chain error.

## Verify

Run `pnpm --filter @alexandria/relayer build` and `pnpm --filter @alexandria/relayer test` from the workspace root.

For the real local-chain tests, put `anvil` on PATH and first run `forge soldeer install --config-location foundry` and `forge build` in `contracts/`. The integration suite starts its own loopback Anvil, generates an ephemeral signer in memory and deploys a local registry. Without Anvil or the built contract artifact, only that integration suite is skipped; HTTP, cap and configuration tests still run. It never contacts Fuji or spends real funds.
