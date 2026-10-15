# Reachability report

OONI measurements from **2026-09-15 to 2026-10-15** (UTC), generated 2026-10-15T06:46Z by `infra/ooni/report.mjs`.
Re-run it with `--until <date>` to reproduce these numbers.

**How to read this:**

- Source: the OONI aggregation API, `web_connectivity` test per domain, plus the `tor` test per country.
- An OONI **anomaly is not the same as a confirmed block**. It means the measurement looked unlike a normal
  connection (DNS, TCP, TLS or HTTP differed). Confirmed blocks are the cases OONI matched to a known block page.
- OONI probes are run by **volunteers**, so sample sizes differ a lot between countries and domains.
- Zero measurements means **unknown**, not reachable.
- anomaly rate (%) = anomalies ÷ measurements × 100.

## Key findings

Generated from the tables below: anomaly rate ≥ 50% with at least 20 measurements, and targets with no data.

- CN: high anomaly rate for ipfs.io (89.6% of 48)
- CN: high anomaly rate for dweb.link (87.0% of 46)
- CN: high anomaly rate for tor (OONI tor test) (96.8% of 312)
- CN: no data for ipfs.filebase.io, api.avax-test.network, github.io, avalanche-fuji-c-chain-rpc.publicnode.com, avalanche-fuji.drpc.org, gateway.pinata.cloud, 4everland.io, storry.tv
- IR: no data for ipfs.filebase.io, api.avax-test.network, github.io, torproject.org, avalanche-fuji-c-chain-rpc.publicnode.com, avalanche-fuji.drpc.org, gateway.pinata.cloud, 4everland.io, storry.tv
- RU: high anomaly rate for ipfs.io (76.6% of 755)
- RU: high anomaly rate for tor (OONI tor test) (97.6% of 45403)
- RU: no data for ipfs.filebase.io, api.avax-test.network, github.io, avalanche-fuji-c-chain-rpc.publicnode.com, avalanche-fuji.drpc.org, gateway.pinata.cloud, 4everland.io, storry.tv
- US: no data for ipfs.filebase.io, api.avax-test.network, github.io, torproject.org, avalanche-fuji-c-chain-rpc.publicnode.com, avalanche-fuji.drpc.org, gateway.pinata.cloud, 4everland.io, storry.tv

## China (CN)

| domain | measurements | anomalies | confirmed blocks | anomaly rate (%) |
|---|---:|---:|---:|---:|
| ipfs.io | 48 | 43 | 0 | 89.6 |
| dweb.link | 46 | 40 | 1 | 87.0 |
| ipfs.filebase.io | 0 | 0 | 0 | unknown |
| api.avax-test.network | 0 | 0 | 0 | unknown |
| github.io | 0 | 0 | 0 | unknown |
| torproject.org | 5 | 4 | 0 | 80.0 |
| avalanche-fuji-c-chain-rpc.publicnode.com | 0 | 0 | 0 | unknown |
| avalanche-fuji.drpc.org | 0 | 0 | 0 | unknown |
| gateway.pinata.cloud | 0 | 0 | 0 | unknown |
| 4everland.io | 0 | 0 | 0 | unknown |
| storry.tv | 0 | 0 | 0 | unknown |
| tor (OONI tor test) | 312 | 302 | 0 | 96.8 |

## Iran (IR)

| domain | measurements | anomalies | confirmed blocks | anomaly rate (%) |
|---|---:|---:|---:|---:|
| ipfs.io | 144 | 4 | 0 | 2.8 |
| dweb.link | 143 | 2 | 0 | 1.4 |
| ipfs.filebase.io | 0 | 0 | 0 | unknown |
| api.avax-test.network | 0 | 0 | 0 | unknown |
| github.io | 0 | 0 | 0 | unknown |
| torproject.org | 0 | 0 | 0 | unknown |
| avalanche-fuji-c-chain-rpc.publicnode.com | 0 | 0 | 0 | unknown |
| avalanche-fuji.drpc.org | 0 | 0 | 0 | unknown |
| gateway.pinata.cloud | 0 | 0 | 0 | unknown |
| 4everland.io | 0 | 0 | 0 | unknown |
| storry.tv | 0 | 0 | 0 | unknown |
| tor (OONI tor test) | 4011 | 853 | 0 | 21.3 |

## Russia (RU)

| domain | measurements | anomalies | confirmed blocks | anomaly rate (%) |
|---|---:|---:|---:|---:|
| ipfs.io | 755 | 578 | 0 | 76.6 |
| dweb.link | 774 | 34 | 0 | 4.4 |
| ipfs.filebase.io | 0 | 0 | 0 | unknown |
| api.avax-test.network | 0 | 0 | 0 | unknown |
| github.io | 0 | 0 | 0 | unknown |
| torproject.org | 29 | 0 | 0 | 0.0 |
| avalanche-fuji-c-chain-rpc.publicnode.com | 0 | 0 | 0 | unknown |
| avalanche-fuji.drpc.org | 0 | 0 | 0 | unknown |
| gateway.pinata.cloud | 0 | 0 | 0 | unknown |
| 4everland.io | 0 | 0 | 0 | unknown |
| storry.tv | 0 | 0 | 0 | unknown |
| tor (OONI tor test) | 45403 | 44323 | 0 | 97.6 |

## United States (US)

| domain | measurements | anomalies | confirmed blocks | anomaly rate (%) |
|---|---:|---:|---:|---:|
| ipfs.io | 979 | 15 | 0 | 1.5 |
| dweb.link | 569 | 15 | 0 | 2.6 |
| ipfs.filebase.io | 0 | 0 | 0 | unknown |
| api.avax-test.network | 0 | 0 | 0 | unknown |
| github.io | 0 | 0 | 0 | unknown |
| torproject.org | 0 | 0 | 0 | unknown |
| avalanche-fuji-c-chain-rpc.publicnode.com | 0 | 0 | 0 | unknown |
| avalanche-fuji.drpc.org | 0 | 0 | 0 | unknown |
| gateway.pinata.cloud | 0 | 0 | 0 | unknown |
| 4everland.io | 0 | 0 | 0 | unknown |
| storry.tv | 0 | 0 | 0 | unknown |
| tor (OONI tor test) | 66492 | 5510 | 0 | 8.3 |
