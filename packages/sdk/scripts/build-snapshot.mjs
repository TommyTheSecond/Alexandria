#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export function snapshotFromCatalog(catalog, contract) {
  if (catalog?.source !== 'live') throw new Error('snapshot builder requires live chain data');
  if (catalog.network !== 'fuji' || catalog.chainId !== 43113) throw new Error('snapshot builder requires Fuji');
  if (catalog.contract?.toLowerCase() !== contract.toLowerCase()) throw new Error('catalog contract differs from deployment');
  if (!Number.isSafeInteger(catalog.atBlock) || catalog.atBlock < 0) throw new Error('invalid catalog block');
  if (!Array.isArray(catalog.books)) throw new Error('invalid catalog books');
  const books = catalog.books.filter(book => book.status === 'approved' || book.status === 'flagged')
    .sort((a, b) => a.id - b.id);
  if (books.some(book => !book.meta)) throw new Error('book metadata is unavailable; keeping the previous snapshot');
  return { ...catalog, source: 'snapshot', books };
}

async function main() {
  const read = path => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
  const deployment = read('deployments/fuji.json');
  const { createClient } = await import('../dist/index.js');
  const client = createClient({
    rpcUrls: read('infra/rpcs.json').clearnet,
    gateways: read('infra/gateways.json').clearnet,
    apiBase: '', contract: deployment.address, snapshotUrls: [], deployBlock: deployment.deployBlock,
  });
  const snapshot = snapshotFromCatalog(await client.getCatalog({ live: true }), deployment.address);
  const output = join(ROOT, 'snapshots', 'latest.json');
  mkdirSync(join(ROOT, 'snapshots'), { recursive: true });
  writeFileSync(output, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Snapshot at block ${snapshot.atBlock}: ${snapshot.books.length} approved or flagged books`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`build-snapshot: ${error.message}`); process.exitCode = 1; });
}
