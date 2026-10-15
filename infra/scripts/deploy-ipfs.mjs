#!/usr/bin/env node
// Builds the reader and publishes it to IPFS (A6 T5): our Kubo node, plus a CAR upload to Filebase.
//   node --env-file=infra/.env infra/scripts/deploy-ipfs.mjs        build, add, upload, print URLs
//   node infra/scripts/deploy-ipfs.mjs --no-build --dist <dir>       publish an existing build
// Env: API_BASE (tunnel URL + /api for this deploy) and FILEBASE_* (see infra/.env.example).
// Kubo must be running (infra/onion/start.sh).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { filebaseConfig, uploadCar } from './filebase.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CONFIG = join(ROOT, 'infra/config/config.json');

/** The config.json shipped inside this deploy: committed values, with apiBase overridable per run. */
export function runtimeConfig(committed, env) {
  return { ...committed, ...(env.API_BASE ? { apiBase: env.API_BASE } : {}) };
}

export function gatewayUrls(cid, gateways, onion) {
  const urls = gateways.clearnet.filter((g) => g.startsWith('https://')).map((g) => `${g}/ipfs/${cid}/`);
  if (onion) urls.push(`http://${onion}/ipfs/${cid}/`);
  return urls;
}

function ipfs(...args) {
  return execFileSync('ipfs', args, {
    encoding: 'utf8',
    env: { ...process.env, IPFS_PATH: process.env.IPFS_PATH ?? join(ROOT, 'infra/kubo') },
  }).trim();
}

async function uploadToFilebase(cid) {
  let cfg;
  try {
    cfg = filebaseConfig(process.env);
  } catch (e) {
    console.log(`filebase  skipped: ${e.message}`);
    return;
  }
  // A CAR upload works even though our Kubo node is behind NAT; a remote pin would need
  // Filebase to fetch the blocks from us.
  const car = execFileSync('ipfs', ['dag', 'export', cid], {
    env: { ...process.env, IPFS_PATH: process.env.IPFS_PATH ?? join(ROOT, 'infra/kubo') },
    maxBuffer: 512 * 1024 ** 2,
  });
  const got = await uploadCar(cfg, `site/${cid}.car`, car);
  if (got !== cid) throw new Error(`Filebase imported ${got}, expected ${cid}`);
  console.log(`filebase  uploaded and pinned (${(car.length / 1024).toFixed(0)} KB CAR)`);
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--dist');
  const dist = i >= 0 ? args[i + 1] : join(ROOT, 'apps/reader/dist');

  if (!args.includes('--no-build')) {
    if (!existsSync(join(ROOT, 'apps/reader/package.json'))) {
      console.error('apps/reader does not exist yet (A4). Use --no-build --dist <dir> to publish something else.');
      process.exit(1);
    }
    execFileSync('pnpm', ['--filter', '@alexandria/reader', 'build'], { cwd: ROOT, stdio: 'inherit' });
  }
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`${dist} has no index.html`);

  const committed = JSON.parse(readFileSync(CONFIG, 'utf8'));
  writeFileSync(join(dist, 'config.json'), JSON.stringify(runtimeConfig(committed, process.env), null, 2) + '\n');

  const cid = ipfs('add', '-r', '-Q', '--cid-version=1', '--pin=true', dist);
  console.log(`site CID  ${cid}`);
  await uploadToFilebase(cid);

  // The next deploy (and GitHub Pages) ship this CID in config.json; commit the change.
  writeFileSync(CONFIG, JSON.stringify({ ...committed, siteCid: cid }, null, 2) + '\n');
  console.log('config    infra/config/config.json siteCid updated: commit it');

  const gateways = JSON.parse(readFileSync(join(ROOT, 'infra/gateways.json'), 'utf8'));
  for (const u of gatewayUrls(cid, gateways, committed.onion)) console.log(`open      ${u}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
