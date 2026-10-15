import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { parseListObjects, usageSummary, filebaseConfig, bucketUsage, uploadCar } from './filebase.mjs';

const page = (truncated, token) => `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult><Name>b</Name><KeyCount>2</KeyCount><IsTruncated>${truncated}</IsTruncated>
${token ? `<NextContinuationToken>${token}</NextContinuationToken>` : ''}
<Contents><Key>a.pdf</Key><Size>1000</Size></Contents>
<Contents><Key>b.json</Key><Size>234</Size></Contents></ListBucketResult>`;

test('sums object sizes from one ListObjectsV2 page', () => {
  assert.deepEqual(parseListObjects(page('false')), { bytes: 1234, objects: 2, next: null });
});

test('returns the continuation token when the listing is truncated', () => {
  assert.equal(parseListObjects(page('true', 'tok/123')).next, 'tok/123');
});

test('usage under 1 GB is ok', () => {
  const s = usageSummary(500 * 1024 ** 2);
  assert.equal(s.level, 'ok');
  assert.match(s.text, /500\.0 MB of 5 GB/);
});

test('usage over 1 GB warns (README 14: keep the corpus under 1 GB)', () => {
  assert.equal(usageSummary(1.5 * 1024 ** 3).level, 'warn');
});

test('usage at the 5 GB free tier is full', () => {
  assert.equal(usageSummary(5 * 1024 ** 3).level, 'full');
});

test('config needs all three Filebase variables and names the missing ones', () => {
  assert.throws(() => filebaseConfig({ FILEBASE_BUCKET: 'b' }), /FILEBASE_ACCESS_KEY_ID, FILEBASE_SECRET_ACCESS_KEY/);
  assert.deepEqual(filebaseConfig({ FILEBASE_ACCESS_KEY_ID: 'k', FILEBASE_SECRET_ACCESS_KEY: 's', FILEBASE_BUCKET: 'b' }), {
    accessKeyId: 'k', secretAccessKey: 's', bucket: 'b', endpoint: 'https://s3.filebase.com',
  });
});

async function fakeS3(handler) {
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      handler(req, res, seen.length);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const cfg = { accessKeyId: 'k', secretAccessKey: 's', bucket: 'b', endpoint: `http://127.0.0.1:${server.address().port}` };
  return { cfg, seen, close: () => server.close() };
}

test('bucketUsage follows continuation tokens and signs every request', async () => {
  const s3 = await fakeS3((req, res, n) => res.end(n === 1 ? page('true', 'tok/1') : page('false')));
  const usage = await bucketUsage(s3.cfg);
  s3.close();
  assert.deepEqual(usage, { bytes: 2468, objects: 4 });
  assert.equal(s3.seen.length, 2);
  assert.match(s3.seen[1].url, /continuation-token=tok%2F1/);
  for (const r of s3.seen) assert.match(r.headers.authorization, /^AWS4-HMAC-SHA256 Credential=k\//);
});

test('uploadCar PUTs the CAR with the import header and returns the CID Filebase reports', async () => {
  const s3 = await fakeS3((req, res) => {
    res.setHeader('x-amz-meta-cid', 'bafyroot');
    res.end();
  });
  const cid = await uploadCar(s3.cfg, 'site/bafyroot.car', Buffer.from('car-bytes'));
  s3.close();
  assert.equal(cid, 'bafyroot');
  const [put] = s3.seen;
  assert.equal(put.method, 'PUT');
  assert.equal(put.url, '/b/site/bafyroot.car');
  assert.equal(put.headers['x-amz-meta-import'], 'car');
  assert.equal(put.body.toString(), 'car-bytes');
  assert.match(put.headers.authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-meta-import,/);
});

test('an S3 error surfaces the HTTP status', async () => {
  const s3 = await fakeS3((req, res) => {
    res.statusCode = 403;
    res.end('<Error><Code>AccessDenied</Code></Error>');
  });
  await assert.rejects(bucketUsage(s3.cfg), /HTTP 403/);
  s3.close();
});
