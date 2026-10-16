import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const deployment = JSON.parse(readFileSync(resolve(ROOT, 'deployments/fuji.json'), 'utf8'));
const rpcs = JSON.parse(readFileSync(resolve(ROOT, 'infra/rpcs.json'), 'utf8'));

// Load Filebase credentials from environment or infra/.env
let env = { ...process.env };
const envPath = resolve(ROOT, 'infra/.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim();
  }
}

if (!env.FILEBASE_ACCESS_KEY_ID || !env.FILEBASE_SECRET_ACCESS_KEY || !env.FILEBASE_BUCKET) {
  console.error('Filebase credentials not found in environment or infra/.env. Skipping cleanup.');
  process.exit(0);
}

const { signRequest } = await import(new URL('infra/scripts/sigv4.mjs', 'file:///' + ROOT.replace(/\\/g, '/')));
const ENDPOINT = env.FILEBASE_ENDPOINT || 'https://s3.filebase.com';
const BUCKET = env.FILEBASE_BUCKET;

async function s3(method, path, { query = {}, headers = {}, body } = {}) {
  const url = new URL(`${ENDPOINT}/${BUCKET}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const payloadHash = body ? createHash('sha256').update(body).digest('hex') : createHash('sha256').update('').digest('hex');
  const signed = signRequest({
    method, url: url.toString(), region: 'us-east-1', service: 's3',
    headers: { ...headers, 'x-amz-content-sha256': payloadHash },
    accessKeyId: env.FILEBASE_ACCESS_KEY_ID, secretAccessKey: env.FILEBASE_SECRET_ACCESS_KEY,
  });
  delete signed.host;
  const res = await fetch(url, { method, headers: signed, body });
  if (!res.ok) throw new Error(`Filebase ${method} ${path}: HTTP ${res.status}`);
  return res;
}

const tag = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([^<]*)</${name}>`, 'g'))].map((m) => m[1]);

export async function cleanupFilebase({ dryRun = false } = {}) {
  console.log(`Checking live registry on Fuji (${deployment.address})...`);
  const { createClient } = await import(new URL('packages/sdk/dist/index.js', 'file:///' + ROOT.replace(/\\/g, '/')));
  const sdk = createClient({
    contract: deployment.address,
    rpcUrls: rpcs.clearnet,
    gateways: [],
    snapshotUrls: [],
    deployBlock: deployment.deployBlock,
    apiBase: '',
  });

  const catalog = await sdk.getCatalog({ live: true });
  const pending = await sdk.getPending();

  const keepCids = new Set();
  for (const b of [...catalog.books, ...pending]) {
    if (b.pdfCid) keepCids.add(b.pdfCid);
    if (b.metaCid) keepCids.add(b.metaCid);
    if (b.meta?.scanReportCid) keepCids.add(b.meta.scanReportCid);
    if (b.meta?.pdf?.cid) keepCids.add(b.meta.pdf.cid);
  }

  // Include snapshot references
  const snapPath = resolve(ROOT, 'snapshots/latest.json');
  if (existsSync(snapPath)) {
    try {
      const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
      for (const b of snap.books || []) {
        if (b.pdfCid) keepCids.add(b.pdfCid);
        if (b.metaCid) keepCids.add(b.metaCid);
        if (b.meta?.scanReportCid) keepCids.add(b.meta.scanReportCid);
        if (b.meta?.pdf?.cid) keepCids.add(b.meta.pdf.cid);
      }
    } catch {}
  }

  console.log(`Protected CIDs (approved, pending, and snapshot): ${keepCids.size}`);

  // List all Filebase objects
  const objects = [];
  let next = null;
  do {
    const query = { 'list-type': '2', ...(next ? { 'continuation-token': next } : {}) };
    const res = await s3('GET', '', { query });
    const xml = await res.text();
    const keys = tag(xml, 'Key');
    const sizes = tag(xml, 'Size');
    for (let i = 0; i < keys.length; i++) {
      objects.push({ key: keys[i], size: Number(sizes[i]) });
    }
    const truncated = tag(xml, 'IsTruncated')[0] === 'true';
    next = truncated ? tag(xml, 'NextContinuationToken')[0] : null;
  } while (next);

  console.log(`Current Filebase objects: ${objects.length} (${(objects.reduce((a, b) => a + b.size, 0) / (1024 * 1024)).toFixed(2)} MB)`);

  const toDelete = [];
  for (const obj of objects) {
    const cid = obj.key.replace(/^snapshots\//, '').replace(/\.car$/, '');
    if (!keepCids.has(cid)) {
      toDelete.push(obj);
    }
  }

  if (toDelete.length === 0) {
    console.log('Filebase is clean! No unwanted or rejected objects found.');
    return { deleted: 0, retained: objects.length };
  }

  console.log(`Found ${toDelete.length} unwanted objects (${(toDelete.reduce((a, b) => a + b.size, 0) / (1024 * 1024)).toFixed(2)} MB).`);
  if (dryRun) {
    console.log('Dry run: no objects deleted.');
    return { wouldDelete: toDelete.length, retained: objects.length - toDelete.length };
  }

  const concurrency = 20;
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += concurrency) {
    const batch = toDelete.slice(i, i + concurrency);
    await Promise.all(batch.map(async (obj) => {
      const path = `/${obj.key.split('/').map(encodeURIComponent).join('/')}`;
      await s3('DELETE', path);
      deleted++;
    }));
  }

  console.log(`Successfully deleted ${deleted} unwanted objects from Filebase.`);
  return { deleted, retained: objects.length - deleted };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cleanupFilebase().catch((err) => {
    console.error('Filebase cleanup error:', err);
    process.exit(1);
  });
}
