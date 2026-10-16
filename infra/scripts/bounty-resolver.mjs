#!/usr/bin/env node
// Bounty payouts on the onion host (I9, plan D4-4). Runs from the sync loop, only when the bounty contract is deployed.
//   node --env-file=infra/.env infra/scripts/bounty-resolver.mjs             propose + execute
//   node infra/scripts/bounty-resolver.mjs --dry-run                         print what it would do, send nothing
// 1. Propose: for each registry book whose metadata names an open bounty, sign proposePayout once a curator has
//    approved the book (curators verify the match), or as soon as the scanner's bounty.match says `auto` (U-Bot).
//    Bounty uploads still waiting for a curator are re-checked every round (state file `watching`).
// 2. Execute: for each proposed bounty whose dispute window is over and whose book a curator approved, executePayout.
// Signs with the host signer (same wallet as the fund's attester): HOST_SIGNER_KEY, or the keystore at
// HOST_KEYSTORE (default ~/.alexandria/host-signer.json) with HOST_PASSWORD_FILE (default ~/.alexandria/host-signer.pwd).
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CID = /^baf[a-z2-7]{20,97}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const STATES = ['none', 'open', 'proposed', 'paid', 'cancelled'];
const APPROVED = 2; // IAlexandria.Status.Approved
const REJECTED = 3; // IAlexandria.Status.Rejected

/** The bounty.match verdict for `bountyId` in a scan report, or null. */
export function verdictFor(report, bountyId) {
  const check = Array.isArray(report?.checks) ? report.checks.find((c) => c?.id === 'bounty.match') : null;
  if (!check || typeof check.detail !== 'string') return null;
  try {
    const v = JSON.parse(check.detail);
    return v && v.bountyId === bountyId ? v : null;
  } catch {
    return null;
  }
}

/**
 * Decides what to do; no chain writes. `chain` and `fetchJson` are injected so this is testable.
 * A bounty upload is proposed once a curator has approved its book (the curator is the verifier), or earlier
 * if the scanner's bounty.match says `auto` (U-Bot match + cross-checks). Uploads still waiting for a curator
 * stay in `watching` and are checked again every round.
 * Returns { proposals: [{bountyId, bookId, payee, verdictCid}], executions: [bountyId], nextBookId, watching, notes }.
 */
export async function planActions({ chain, fetchJson, now, lastBookId = 0, watching = [] }) {
  const notes = [];
  const proposals = [];
  const executions = [];
  const bookCount = await chain.bookCount();
  let nextBookId = lastBookId;
  const claimed = new Set(); // one proposal per bounty per round
  const candidates = watching.filter((w) => Number.isSafeInteger(w?.bookId) && w.bookId <= lastBookId);

  // 1. New books: find bounty uploads.
  for (let bookId = lastBookId + 1; bookId <= bookCount; bookId++) {
    const book = await chain.getBook(bookId);
    let meta;
    try {
      meta = await fetchJson(book.metaCid);
    } catch {
      notes.push(`book #${bookId}: metadata not reachable yet; retrying next round`);
      break; // keep order: don't skip past a book we couldn't read
    }
    nextBookId = bookId;
    const bountyId = meta?.bountyId;
    if (!Number.isSafeInteger(bountyId) || bountyId < 1) continue; // not a bounty upload
    const label = `book #${bookId} → bounty #${bountyId}`;
    if (!ADDRESS.test(String(meta.contributor ?? ''))) { notes.push(`${label}: no payout address; skipped`); continue; }
    if (!CID.test(String(meta.scanReportCid ?? ''))) { notes.push(`${label}: no scan report; skipped`); continue; }
    let auto = false;
    try {
      auto = verdictFor(await fetchJson(meta.scanReportCid), bountyId)?.auto === true;
    } catch { /* no AI verdict needed: the curator's approval decides */ }
    // Lower-case: the address was typed by the uploader; a mixed-case one with a bad checksum would be rejected.
    candidates.push({ bookId, bountyId, payee: meta.contributor.toLowerCase(), verdictCid: meta.scanReportCid, auto });
  }

  // 2. Every bounty upload we know about: propose, keep watching, or drop.
  const stillWatching = [];
  for (const c of candidates) {
    const label = `book #${c.bookId} → bounty #${c.bountyId}`;
    try {
      const book = await chain.getBook(c.bookId);
      if (book.status === REJECTED) { notes.push(`${label}: book rejected by a curator; dropped`); continue; }
      let bounty;
      try {
        bounty = await chain.getBounty(c.bountyId);
      } catch {
        notes.push(`${label}: bounty not found; dropped`);
        continue;
      }
      if (bounty.state === 'paid' || bounty.state === 'cancelled') { notes.push(`${label}: bounty is ${bounty.state}; dropped`); continue; }
      if (now >= bounty.deadline) { notes.push(`${label}: bounty deadline passed; dropped`); continue; }
      if (book.submittedAt < bounty.createdAt) { notes.push(`${label}: book is older than the bounty; dropped`); continue; }
      if (await chain.bookUsed(c.bookId)) { notes.push(`${label}: book already paid another bounty; dropped`); continue; }
      const ready = book.status === APPROVED || c.auto;
      if (!ready) { notes.push(`${label}: waiting for a curator to approve the book`); stillWatching.push(c); continue; }
      if (bounty.state !== 'open' || claimed.has(c.bountyId)) { notes.push(`${label}: bounty is ${bounty.state}; watching`); stillWatching.push(c); continue; }
      claimed.add(c.bountyId);
      proposals.push({ bountyId: c.bountyId, bookId: c.bookId, payee: c.payee, verdictCid: c.verdictCid });
    } catch (error) {
      notes.push(`${label}: could not be read (${error?.message ?? 'error'}); retrying next round`);
      stillWatching.push(c);
    }
  }

  const bountyCount = await chain.bountyCount();
  for (let id = 1; id <= bountyCount; id++) {
    try {
      const bounty = await chain.getBounty(id);
      if (bounty.state !== 'proposed' || now < bounty.executableAt) continue;
      const book = await chain.getBook(bounty.bookId);
      if (book.status === APPROVED) executions.push(id);
      else notes.push(`bounty #${id}: window over, waiting for a curator to approve book #${bounty.bookId}`);
    } catch (error) {
      notes.push(`bounty #${id}: could not be read (${error?.message ?? 'error'}); retrying next round`);
    }
  }
  return { proposals, executions, nextBookId, watching: stillWatching, notes };
}

// ---------- wiring (real chain, real gateways) ----------

function load(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function deps() {
  // viem and ethers come from the workspace packages that depend on them (pnpm keeps the repo root clean).
  const fromSdk = createRequire(join(ROOT, 'packages/sdk/package.json'));
  const fromRelayer = createRequire(join(ROOT, 'relayer/package.json'));
  const imp = (req, name) => import(pathToFileURL(req.resolve(name)).href);
  const [viem, chains, accounts, ethers] = await Promise.all([
    imp(fromSdk, 'viem'), imp(fromSdk, 'viem/chains'), imp(fromSdk, 'viem/accounts'), imp(fromRelayer, 'ethers'),
  ]);
  return { viem, chains, accounts, ethers: ethers.default ?? ethers };
}

async function hostSignerKey(ethers) {
  if (process.env.HOST_SIGNER_KEY) {
    const raw = process.env.HOST_SIGNER_KEY.trim();
    return raw.startsWith('0x') ? raw : `0x${raw}`;
  }
  const home = process.env.HOME || '';
  const keystore = process.env.HOST_KEYSTORE ?? resolve(home, '.alexandria/host-signer.json');
  const passwordFile = process.env.HOST_PASSWORD_FILE ?? resolve(home, '.alexandria/host-signer.pwd');
  if (!existsSync(keystore) || !existsSync(passwordFile)) {
    throw new Error('host signer not configured (HOST_SIGNER_KEY, or HOST_KEYSTORE + HOST_PASSWORD_FILE)');
  }
  const password = readFileSync(passwordFile, 'utf8').replace(/\r?\n$/, '');
  const wallet = await ethers.Wallet.fromEncryptedJson(readFileSync(keystore, 'utf8'), Buffer.from(password, 'utf8'));
  return wallet.privateKey;
}

export function gatewayFetcher(gateways, timeoutMs = 15000) {
  return async function fetchJson(cid) {
    if (!CID.test(String(cid))) throw new Error('bad CID');
    let lastError;
    for (const gw of gateways) {
      try {
        const res = await fetch(`${gw.replace(/\/$/, '')}/ipfs/${cid}`, { signal: AbortSignal.timeout(timeoutMs) });
        if (res.ok) return await res.json();
        lastError = new Error(`HTTP ${res.status}`);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error('no gateway');
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const bountiesPath = process.env.BOUNTIES_DEPLOYMENT ?? join(ROOT, 'deployments/fuji-bounties.json');
  if (!existsSync(bountiesPath)) {
    console.log('bounty-resolver: bounties are not deployed; nothing to do');
    return;
  }
  const bountiesDeployment = load(bountiesPath);
  const registryAddress = bountiesDeployment.registry ?? load(join(ROOT, 'deployments/fuji.json')).address;
  const statePath = process.env.BOUNTY_RESOLVER_STATE ?? join(ROOT, 'infra/onion/run/bounty-resolver.json');
  const state = existsSync(statePath) ? load(statePath) : { lastBookId: 0, watching: [] };
  const rpcUrls = process.env.BOUNTY_RPC_URL ? [process.env.BOUNTY_RPC_URL] : load(join(ROOT, 'infra/rpcs.json')).clearnet;
  // Our own Kubo node first (it pinned every upload), then the public gateways. BOUNTY_GATEWAYS overrides (tests).
  const gateways = process.env.BOUNTY_GATEWAYS
    ? process.env.BOUNTY_GATEWAYS.split(',').map((g) => g.trim()).filter(Boolean)
    : ['http://127.0.0.1:8080', ...load(join(ROOT, 'infra/gateways.json')).clearnet];

  const { viem, chains, accounts, ethers } = await deps();
  const chainDef = chains.avalancheFuji;
  const transport = viem.fallback(rpcUrls.map((url) => viem.http(url, { timeout: 15000 })));
  const pub = viem.createPublicClient({ chain: chainDef, transport });
  const bountyAbi = load(join(ROOT, 'deployments/abi/IAlexandriaBounties.json'));
  const registryAbi = load(join(ROOT, 'deployments/abi/IAlexandria.json'));
  const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
  const chain = {
    bookCount: async () => Number(await read(registryAddress, registryAbi, 'bookCount')),
    getBook: async (id) => {
      const b = await read(registryAddress, registryAbi, 'getBook', [BigInt(id)]);
      return { metaCid: b.metaCid, submittedAt: Number(b.submittedAt), status: Number(b.status) };
    },
    bountyCount: async () => Number(await read(bountiesDeployment.address, bountyAbi, 'bountyCount')),
    getBounty: async (id) => {
      const b = await read(bountiesDeployment.address, bountyAbi, 'getBounty', [BigInt(id)]);
      return { state: STATES[Number(b.state)] ?? 'none', deadline: Number(b.deadline), createdAt: Number(b.createdAt),
        executableAt: Number(b.executableAt), bookId: Number(b.bookId) };
    },
    bookUsed: (id) => read(bountiesDeployment.address, bountyAbi, 'bookUsed', [BigInt(id)]),
  };

  // Chain time can lag on a quiet chain; the contract enforces the window anyway (simulate fails early, retried).
  const block = await pub.getBlock();
  const now = Math.max(Number(block.timestamp), Math.floor(Date.now() / 1000));
  const plan = await planActions({ chain, fetchJson: gatewayFetcher(gateways), now, lastBookId: state.lastBookId ?? 0,
    watching: Array.isArray(state.watching) ? state.watching : [] });
  for (const note of plan.notes) console.log(`bounty    ${note}`);
  if (!plan.proposals.length && !plan.executions.length) {
    console.log(`bounty    nothing to propose or execute (checked books up to #${plan.nextBookId})`);
  }

  let wallet = null;
  if (!dryRun && (plan.proposals.length || plan.executions.length)) {
    const account = accounts.privateKeyToAccount(await hostSignerKey(ethers));
    wallet = viem.createWalletClient({ account, chain: chainDef, transport });
  }
  async function send(functionName, args, label) {
    if (dryRun) { console.log(`bounty    would ${label}`); return true; }
    try {
      const { request } = await pub.simulateContract({ address: bountiesDeployment.address, abi: bountyAbi, functionName, args, account: wallet.account });
      const hash = await wallet.writeContract(request);
      const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120000 });
      if (receipt.status !== 'success') throw new Error('transaction reverted');
      console.log(`bounty    ${label}: ${hash}`);
      return true;
    } catch (error) {
      const name = error?.cause?.data?.errorName ?? error?.data?.errorName ?? error?.shortMessage ?? 'failed';
      console.log(`bounty    ${label} failed (${name}); retrying next round`);
      return false;
    }
  }

  const watchingNext = [...plan.watching];
  for (const p of plan.proposals) {
    const sent = await send('proposePayout', [BigInt(p.bountyId), BigInt(p.bookId), p.payee, p.verdictCid],
      `propose bounty #${p.bountyId} → book #${p.bookId}, pay ${p.payee}`);
    if (!sent) watchingNext.push({ ...p, auto: false }); // look at this book again next round
  }
  for (const id of plan.executions) await send('executePayout', [BigInt(id)], `execute bounty #${id}`);

  if (!dryRun) {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ lastBookId: plan.nextBookId, watching: watchingNext, updatedAt: new Date().toISOString() }, null, 2) + '\n');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`bounty-resolver: ${error.message}`);
    process.exit(1);
  });
}
