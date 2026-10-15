#!/usr/bin/env node
// Re-checks every RPC and IPFS gateway and prints a pass/fail table (A6 T2). Run at H+14 and H+22.
//   node infra/scripts/check-endpoints.mjs
//   node infra/scripts/check-endpoints.mjs --cid <good.pdf CID> --sha256 0x<hash>   (check with the real fixture)
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const FUJI = '0xa869';

// Default probe: the IPFS gateway checker file, which every public gateway can fetch.
export const DEFAULT_PROBE = {
  cid: 'bafybeifx7yeb55armcsxwwitkymga5xf53dxiarykms3ygqic223w5sk3m',
  sha256: '0x7530010a7ec61daef2e028720f102a75d40af932528e742eb10cdae4de8d7004',
};

async function timed(url, init, timeoutMs) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
    throw new Error(timeout ? `timeout after ${timeoutMs} ms` : e.cause?.code ?? e.message);
  }
}

export async function checkRpc(url, { timeoutMs = 10_000 } = {}) {
  try {
    const res = await timed(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    }, timeoutMs);
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const json = await res.json();
    if (json.error) return { ok: false, detail: `rpc error: ${json.error.message}` };
    if (json.result !== FUJI) return { ok: false, detail: `chainId ${json.result}, want ${FUJI}` };
    return { ok: true, detail: `chainId ${FUJI}` };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

export async function checkGateway(base, { cid, sha256, timeoutMs = 20_000 } = DEFAULT_PROBE) {
  try {
    const res = await timed(`${base}/ipfs/${cid}`, {}, timeoutMs);
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const bytes = Buffer.from(await res.arrayBuffer());
    const got = '0x' + createHash('sha256').update(bytes).digest('hex');
    if (got !== sha256) return { ok: false, detail: `hash mismatch (${bytes.length} bytes)` };
    return { ok: true, detail: `sha256 ok (${bytes.length} bytes)` };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

// "" (same origin) and "/rpc" only work on the onion build, so they are not checked here.
const remote = (list) => list.filter((u) => u.startsWith('https://'));

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const probe = arg('--cid') ? { cid: arg('--cid'), sha256: arg('--sha256')?.toLowerCase() } : DEFAULT_PROBE;
  if (!probe.sha256) throw new Error('--cid needs --sha256 0x<64 hex>');

  const read = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
  const rpcs = remote(read('rpcs.json').clearnet);
  const gateways = remote(read('gateways.json').clearnet);

  const rows = await Promise.all([
    ...rpcs.map(async (u) => ['rpc', u, await checkRpc(u)]),
    ...gateways.map(async (u) => ['gateway', u, await checkGateway(u, probe)]),
  ]);

  const width = Math.max(...rows.map(([, u]) => u.length));
  console.log(`probe CID ${probe.cid}\n`);
  for (const [kind, url, r] of rows) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${kind.padEnd(7)}  ${url.padEnd(width)}  ${r.detail}`);
  }
  const failed = rows.filter(([, , r]) => !r.ok).length;
  console.log(`\n${rows.length - failed}/${rows.length} endpoints pass`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
