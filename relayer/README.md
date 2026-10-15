# Alexandria relayer

Internal I6 service for wallet-free web submissions. It binds to `127.0.0.1` only; never expose port 8787 through Caddy or a tunnel. Every request, including health checks, needs `X-Relay-Secret`.

## Run

1. Install the workspace with Node 20 and pnpm 9: `pnpm install`.
2. Copy `.env.example` to `.env` locally. Set `RELAYER_KEYSTORE` to the absolute path of the encrypted Foundry JSON file. Raw `RELAYER_PRIVATE_KEY` configuration is rejected. Set `RELAY_SECRET` to a random secret of at least 32 characters, matching the scanner; the onion setup generates it on that host. Never commit secrets or the keystore.
3. Set `RPC_URL` to a Fuji or local Anvil RPC; set `DEPLOYMENT` to `../deployments/fuji.json` or `../deployments/anvil.json`; set `PORT=8787`.
4. From `relayer/`, run `pnpm start`. With an interactive terminal and no `RELAYER_PASSWORD_FILE`, startup asks for the keystore password with echo disabled. Paste once, then Enter. For a background service, set `RELAYER_PASSWORD_FILE` to a host-local credential file containing the password; on Unix it must have owner-only permissions (`0600` or `0400`). Prefer a service-manager credential directory outside the checkout. Protect the file with user ACLs on Windows. A trailing file newline is removed; spaces in the password are preserved.
5. Startup rejects mainnet, a mismatched RPC network, an address without deployed code, a wrong password, or a wallet whose address differs from the `relayer` in I7. Keep the relayer funded with test AVAX.

### P1 handoff to P4

P1 uses `alexandria-relayer` for `0x96e0C244bfC50EA0F4DEcA75df1455E2FA734EE3`. The deployer is a different keystore, `alexandria-deployer-v2`; never use it for this service. The older Core operational addresses are obsolete.

Provision the encrypted relayer keystore and its unlock credential privately on the onion host. Do not export, transmit or paste a raw private key, and do not post either the file or its password to this public repository, issues, PRs, the agent board or assistant chat. The host still needs unlock access: an encrypted file plus its password can control the account. Losing both usable unlock access and backups cannot be repaired by the relayer.

The service uses ethers' asynchronous Web3 V3 JSON decryption. Keys still exist: the key is encrypted at rest, decrypted only in process memory and used by viem to sign. It is never persisted as plaintext by this service, logged, passed as a command argument or loaded from `.env`. Foundry is not required on the service host for decryption. The HTTP API I6 is unchanged.

`GET /health` returns address, balanceWei and sentToday. `POST /relay` accepts exactly pdfCid, metaCid and pdfSha256, following I6. Both CIDs must be CIDv1 base32 and the digest must be lowercase 0x-prefixed SHA-256.

Duplicate lookup, daily-budget reservation and submission share one promise queue, avoiding nonce and duplicate races. Each transaction waits for one confirmation. The in-memory budget resets at 00:00 UTC and caps attempts at 200 per day. Failed broadcast attempts conservatively consume a slot because a transaction might already have been sent. Restarting the process resets these in-memory counters.

Only successful bookId/txHash pairs are logged. RPC request details, headers, signing material, bodies and IP addresses are never logged. The server returns sanitized contract error names or a generic chain error.

## Verify

Run `pnpm --filter @alexandria/relayer build` and `pnpm --filter @alexandria/relayer test` from the workspace root.

For the real local-chain tests, put `anvil` and `cast` on PATH and first run `forge soldeer install --config-location foundry` and `forge build` in `contracts/`. The integration suite starts its own loopback Anvil, generates an ephemeral encrypted keystore in a temporary directory, unlocks it and submits through the service. A separate test unlocks a real `cast wallet new` file. Without Anvil/artifacts or cast, only the corresponding integration tests skip. Linux also tests rejection of group/world-readable password files; that Unix mode-bit test skips on Windows. Tests never read P1's actual wallets, contact Fuji or spend real funds.
