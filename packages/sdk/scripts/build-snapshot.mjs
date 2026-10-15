#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export function snapshotFromCatalog(catalog, contract, blockTimestamp) {
  if (catalog?.source !== 'live') throw new Error('snapshot builder requires live chain data');
  if (catalog.network !== 'fuji' || catalog.chainId !== 43113) throw new Error('snapshot builder requires Fuji');
  if (catalog.contract?.toLowerCase() !== contract.toLowerCase()) throw new Error('catalog contract differs from deployment');
  if (!Number.isSafeInteger(catalog.atBlock) || catalog.atBlock < 0) throw new Error('invalid catalog block');
  if (!Number.isSafeInteger(blockTimestamp) || blockTimestamp < 0) throw new Error('invalid block timestamp');
  if (!Array.isArray(catalog.books)) throw new Error('invalid catalog books');
  const books = catalog.books.filter(book => book.status === 'approved' || book.status === 'flagged')
    .sort((a, b) => a.id - b.id);
  if (books.some(book => !book.meta)) throw new Error('book metadata is unavailable; keeping the previous snapshot');
  return { network: 'fuji', chainId: 43113, contract: catalog.contract, atBlock: catalog.atBlock,
    generatedAt: new Date(blockTimestamp * 1000).toISOString(), source: 'snapshot', books };
}

async function main() {
  const read = path => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
  const option = (name, fallback) => {
    const index = process.argv.indexOf(name);
    if (index < 0) return fallback;
    if (!process.argv[index + 1]) throw new Error(`${name} requires a path`);
    return resolve(process.argv[index + 1]);
  };
  const deployment = JSON.parse(readFileSync(option('--deployment', join(ROOT, 'deployments/fuji.json')), 'utf8'));
  const { createClient } = await import('../dist/index.js');
  const { createPublicClient, fallback, http } = await import('viem');
  const { avalancheFuji } = await import('viem/chains');
  const rpcUrls = read('infra/rpcs.json').clearnet;
  const client = createClient({
    rpcUrls,
    gateways: read('infra/gateways.json').clearnet,
    apiBase: '', contract: deployment.address, snapshotUrls: [], deployBlock: deployment.deployBlock,
  });
  const live = await client.getCatalog({ live: true });
  const chain = createPublicClient({ chain: avalancheFuji,
    transport: fallback(rpcUrls.map(url => http(url, { timeout: 8000 }))) });
  const block = await chain.getBlock({ blockNumber: BigInt(live.atBlock) });
  const snapshot = snapshotFromCatalog(live, deployment.address, Number(block.timestamp));
  const output = option('--out', join(ROOT, 'snapshots/latest.json'));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Snapshot at block ${snapshot.atBlock}: ${snapshot.books.length} approved or flagged books`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`build-snapshot: ${error.message}`); process.exitCode = 1; });
}
