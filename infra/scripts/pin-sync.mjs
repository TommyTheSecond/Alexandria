#!/usr/bin/env node
// Keeps our Kubo node pinning every live book (A6 T4).
//   node --env-file=infra/.env infra/scripts/pin-sync.mjs           dry run: pins what is missing, lists unpins
//   node --env-file=infra/.env infra/scripts/pin-sync.mjs --apply   also unpins Rejected books (Kubo + Filebase)
//   node infra/scripts/pin-sync.mjs --books fixtures/catalog.json    pin from a file (never unpins)
// Ask P4 before every --apply. Unpinning only ever happens on live chain data.
// Needs the SDK build (pnpm --filter @alexandria/sdk build) and deployments/fuji.json for live mode.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { kuboClient } from './kubo.mjs';
import { filebaseConfig, removeCids } from './filebase.mjs';

const ROOT = new URL('../../', import.meta.url);
const LIVE = new Set(['pending', 'approved', 'flagged']);

export function planSync(books, pinned) {
  const needed = new Set(books.filter((b) => LIVE.has(b.status)).flatMap((b) => [b.pdfCid, b.metaCid]));
  const toPin = [...needed].filter((c) => !pinned.has(c));
  const rejected = books.filter((b) => b.status === 'rejected');
  const toUnpin = [...new Set(rejected.flatMap((b) => [b.pdfCid, b.metaCid]))].filter((c) => pinned.has(c) && !needed.has(c));
  return { toPin, toUnpin, rejected };
}

/** Every book on chain: Approved/Flagged from the live catalog, Pending, and Rejected from the gaps. */
export async function collectBooks(sdk) {
  const catalog = await sdk.getCatalog({ live: true });
  if (catalog.source !== 'live') throw new Error('pin-sync needs live chain data; got a snapshot (are all RPCs down?)');
  const byId = new Map([...catalog.books, ...(await sdk.getPending())].map((b) => [b.id, b]));
  const last = Math.max(0, ...byId.keys());
  for (let id = 1; ; id++) {
    if (byId.has(id)) continue;
    try {
      byId.set(id, await sdk.getBook(id));
    } catch (e) {
      if (e.code === 'UNKNOWN_BOOK' && id > last) break; // past the last book
      throw e;
    }
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export async function runSync({ books, kubo, apply, filebase, log = console.log }) {
  const plan = planSync(books, await kubo.pinnedSet());
  const result = { pinned: [], failed: [], unpinned: [], wouldUnpin: [] };

  for (const cid of plan.toPin) {
    try {
      await kubo.pin(cid);
      result.pinned.push(cid);
      log(`pinned    ${cid}`);
    } catch (e) {
      result.failed.push({ cid, error: e.message });
      log(`FAILED    ${cid}: ${e.message}`);
    }
  }
  for (const b of plan.rejected) log(`rejected  #${b.id} ${b.pdfCid} ${b.metaCid}`);

  if (!apply) {
    result.wouldUnpin = plan.toUnpin;
    for (const cid of plan.toUnpin) log(`would unpin ${cid} (run with --apply after asking P4)`);
    return result;
  }
  for (const cid of plan.toUnpin) {
    await kubo.unpin(cid);
    result.unpinned.push(cid);
    log(`unpinned  ${cid} (kubo)`);
  }
  if (plan.toUnpin.length && filebase) {
    await filebase.removeCids(plan.toUnpin);
    log(`unpinned  ${plan.toUnpin.length} CID(s) (filebase)`);
  }
  return result;
}

async function liveSdk() {
  let sdkModule;
  try {
    sdkModule = await import(new URL('packages/sdk/dist/index.js', ROOT));
  } catch {
    throw new Error('SDK not built: run pnpm --filter @alexandria/sdk build');
  }
  const read = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
  let deployment;
  try {
    deployment = read('deployments/fuji.json');
  } catch {
    throw new Error('deployments/fuji.json not found: the contract is not deployed yet (A1). Use --books <file> meanwhile.');
  }
  return sdkModule.createClient({
    rpcUrls: read('infra/rpcs.json').clearnet,
    gateways: read('infra/gateways.json').clearnet,
    apiBase: '',
    contract: deployment.address,
    snapshotUrls: [],
    deployBlock: deployment.deployBlock,
  });
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--books');
  let books;
  let apply = args.includes('--apply');
  if (i >= 0) {
    books = JSON.parse(readFileSync(args[i + 1], 'utf8')).books;
    if (apply) console.log('--apply ignored: unpinning needs live chain data, not a file');
    apply = false;
  } else {
    books = await collectBooks(await liveSdk());
  }

  let filebase;
  try {
    const cfg = filebaseConfig(process.env);
    filebase = { removeCids: (cids) => removeCids(cfg, cids) };
  } catch (e) {
    if (apply) console.log(`filebase  unpin skipped: ${e.message}`);
  }

  const r = await runSync({ books, kubo: kuboClient(), apply, filebase });
  console.log(`\n${books.length} books · pinned ${r.pinned.length} · failed ${r.failed.length} · ` +
    (apply ? `unpinned ${r.unpinned.length}` : `would unpin ${r.wouldUnpin.length}`));
  process.exit(r.failed.length ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`pin-sync: ${e.message}`);
    process.exit(1);
  });
}
