// Filebase S3 helpers shared by filebase-usage.mjs and deploy-ipfs.mjs.
// Credentials come from the environment (infra/.env.example); never print them.
import { createHash } from 'node:crypto';
import { signRequest } from './sigv4.mjs';

const ENDPOINT = 'https://s3.filebase.com';
const REGION = 'us-east-1';
const GB = 1024 ** 3;
export const FREE_TIER_BYTES = 5 * GB;
export const WARN_BYTES = 1 * GB; // README 14: keep the corpus under 1 GB

export function filebaseConfig(env) {
  const names = ['FILEBASE_ACCESS_KEY_ID', 'FILEBASE_SECRET_ACCESS_KEY', 'FILEBASE_BUCKET'];
  const missing = names.filter((n) => !env[n]);
  if (missing.length) throw new Error(`missing ${missing.join(', ')} (see infra/.env.example)`);
  return {
    accessKeyId: env.FILEBASE_ACCESS_KEY_ID,
    secretAccessKey: env.FILEBASE_SECRET_ACCESS_KEY,
    bucket: env.FILEBASE_BUCKET,
    endpoint: env.FILEBASE_ENDPOINT || ENDPOINT,
  };
}

const tag = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([^<]*)</${name}>`, 'g'))].map((m) => m[1]);

export function parseListObjects(xml) {
  const sizes = tag(xml, 'Size').map(Number);
  const truncated = tag(xml, 'IsTruncated')[0] === 'true';
  return { bytes: sizes.reduce((a, b) => a + b, 0), objects: sizes.length, next: truncated ? tag(xml, 'NextContinuationToken')[0] : null };
}

export function usageSummary(bytes) {
  const mb = (bytes / 1024 ** 2).toFixed(1);
  const pct = ((bytes / FREE_TIER_BYTES) * 100).toFixed(1);
  const level = bytes >= FREE_TIER_BYTES ? 'full' : bytes > WARN_BYTES ? 'warn' : 'ok';
  return { level, text: `${mb} MB of 5 GB free tier (${pct}%)` };
}

async function s3(cfg, method, path, { query = {}, headers = {}, body } = {}) {
  const url = new URL(`${cfg.endpoint ?? ENDPOINT}/${cfg.bucket}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const payloadHash = body ? createHash('sha256').update(body).digest('hex') : createHash('sha256').update('').digest('hex');
  const signed = signRequest({
    method, url: url.toString(), region: REGION, service: 's3',
    headers: { ...headers, 'x-amz-content-sha256': payloadHash },
    accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey,
  });
  delete signed.host; // fetch sets it
  const res = await fetch(url, { method, headers: signed, body });
  if (!res.ok) throw new Error(`Filebase ${method} ${path || '/'}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

export async function bucketUsage(cfg) {
  let bytes = 0;
  let objects = 0;
  let next = null;
  do {
    const query = { 'list-type': '2', ...(next ? { 'continuation-token': next } : {}) };
    const page = parseListObjects(await (await s3(cfg, 'GET', '', { query })).text());
    bytes += page.bytes;
    objects += page.objects;
    next = page.next;
  } while (next);
  return { bytes, objects };
}

/** Uploads a CAR file; Filebase imports it and pins its root. Returns the CID Filebase reports. */
export async function uploadCar(cfg, key, car) {
  const res = await s3(cfg, 'PUT', `/${key}`, { headers: { 'x-amz-meta-import': 'car' }, body: car });
  return res.headers.get('x-amz-meta-cid');
}
