#!/usr/bin/env node
// Publishes the catalog snapshot to IPFS (A6 T4): Kubo + a CAR upload to Filebase, then PRINTS the
// curator command that records it on chain. A6 holds no curator key and never signs.
//   node --env-file=infra/.env infra/scripts/publish-snapshot.mjs                 build (A5) + publish
//   node --env-file=infra/.env infra/scripts/publish-snapshot.mjs --skip-build    publish snapshots/latest.json as is
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { kuboClient } from './kubo.mjs';
import { filebaseConfig, uploadCar } from './filebase.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SNAPSHOT = `${ROOT}snapshots/latest.json`;

/** Checks the file is a Fuji snapshot Catalog (I4) and returns its block number. */
export function validateSnapshot(c) {
  if (c?.chainId !== 43113 || c.network !== 'fuji') throw new Error(`not a Fuji catalog (chainId ${c?.chainId})`);
  if (c.source !== 'snapshot') throw new Error(`source must be "snapshot", got ${JSON.stringify(c.source)}`);
  if (!Number.isInteger(c.atBlock) || c.atBlock < 0) throw new Error(`bad atBlock ${c.atBlock}`);
  if (!Array.isArray(c.books)) throw new Error('books must be an array');
  return c.atBlock;
}

export const curateCommand = (cid, block) => `contracts/script/curate.sh snapshot ${cid} ${block}`;

export async function publishSnapshot({ bytes, kubo, upload }) {
  const atBlock = validateSnapshot(JSON.parse(bytes.toString('utf8')));
  const cid = await kubo.add('latest.json', bytes);
  if (upload) {
    const got = await upload(`snapshots/${cid}.car`, await kubo.dagExport(cid));
    if (got !== cid) throw new Error(`Filebase imported ${got}, expected ${cid}`);
  }
  return { cid, atBlock, command: curateCommand(cid, atBlock) };
}

function buildSnapshot() {
  const pkg = JSON.parse(readFileSync(`${ROOT}packages/sdk/package.json`, 'utf8'));
  if (!pkg.scripts?.['build-snapshot']) {
    console.log('build     skipped: @alexandria/sdk has no "build-snapshot" script yet (A5); publishing the existing file');
    return;
  }
  execFileSync('pnpm', ['--filter', '@alexandria/sdk', 'run', 'build-snapshot'], { cwd: ROOT, stdio: 'inherit' });
}

async function main() {
  if (!process.argv.includes('--skip-build')) buildSnapshot();
  if (!existsSync(SNAPSHOT)) throw new Error('snapshots/latest.json does not exist yet (A5 build-snapshot)');

  let upload;
  try {
    const cfg = filebaseConfig(process.env);
    upload = (key, car) => uploadCar(cfg, key, car);
  } catch (e) {
    console.log(`filebase  skipped: ${e.message}`);
  }
  const r = await publishSnapshot({ bytes: readFileSync(SNAPSHOT), kubo: kuboClient(), upload });
  console.log(`snapshot  ${r.cid} (block ${r.atBlock})${upload ? ', on Filebase too' : ''}`);
  console.log('\nA curator records it on chain with:\n');
  console.log(`  ${r.command}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`publish-snapshot: ${e.message}`);
    process.exit(1);
  });
}
