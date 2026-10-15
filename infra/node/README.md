# Alexandria Node Operator Guide

Run a community node for Alexandria to pin public-domain banned books and earn AVAX payouts from every library donation.

---

## How It Works

1. **Pinning:** Your node runs a dedicated Kubo IPFS daemon and syncs all approved books using `pin-sync` every 15 minutes.
2. **Serving:** Your node serves books through a public gateway (a stable Tor `.onion` service or an HTTPS tunnel).
3. **Checking:** The Alexandria checker script probes registered nodes each epoch, downloading random books and verifying their SHA-256 hashes against on-chain records.
4. **Payouts:** Every 10 minutes (demo) or 24 hours (production), active nodes that pass $\ge 80\%$ of checks share **50% of all library donations**. Payouts accumulate on-chain and can be claimed at any time.

---

## Quick Start

### 1. Prerequisites
- Linux, macOS, or Windows WSL2
- Node.js $\ge 20$
- [Kubo (IPFS)](https://docs.ipfs.tech/install/command-line/)
- [Tor](https://www.torproject.org/) (recommended for a stable onion address) or `cloudflared`

### 2. Start Your Node
Run the starter script:
```bash
./infra/node/start-node.sh
```

When started, it outputs your node's gateway URL:
```text
==========================================================
Node Gateway URL: http://zm3fkcrtlaclnxw2u5xjjpauwp3ngchkhu3ji26xrvejf46mglvrkqad.onion
Register this gateway at: https://alexandria.library/#/nodes
==========================================================
```

### 3. Register on Alexandria
1. Open Alexandria in your browser (or Tor Browser): `#/nodes`.
2. Connect your Web3 wallet (e.g. Core or MetaMask on Avalanche Fuji Testnet).
3. Paste your node's gateway URL and click **Register Node**.

### 4. Claim Payouts
At the end of each epoch where your node is active, your payout share is credited to your wallet address. Return to `#/nodes`, connect your wallet, and click **[ CLAIM PAYOUT ]**.
