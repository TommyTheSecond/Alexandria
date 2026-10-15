import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { checkRpc, checkGateway } from './check-endpoints.mjs';

const BYTES = Buffer.from('Hello from IPFS Gateway Checker\n');
const SHA = '0x' + createHash('sha256').update(BYTES).digest('hex');
const CID = 'bafytestcid';

let server;
let base;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const reply = (code, text, type = 'application/json') => {
        res.writeHead(code, { 'content-type': type });
        res.end(text);
      };
      if (req.url === '/fuji') return reply(200, JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0xa869' }));
      if (req.url === '/mainnet') return reply(200, JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0xa86a' }));
      if (req.url === '/rpc-error') return reply(200, JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'Unauthorized' } }));
      if (req.url === `/good/ipfs/${CID}`) return reply(200, BYTES, 'application/octet-stream');
      if (req.url === `/html/ipfs/${CID}`) return reply(200, '<html>gateway error</html>', 'text/html');
      if (req.url === '/hang/ipfs/' + CID) return; // never answers
      reply(404, 'not found', 'text/plain');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

test('rpc passes when it answers chainId 0xa869', async () => {
  assert.equal((await checkRpc(`${base}/fuji`)).ok, true);
});

test('rpc fails on the wrong chain', async () => {
  const r = await checkRpc(`${base}/mainnet`);
  assert.equal(r.ok, false);
  assert.match(r.detail, /0xa86a/);
});

test('rpc fails on a JSON-RPC error', async () => {
  const r = await checkRpc(`${base}/rpc-error`);
  assert.equal(r.ok, false);
  assert.match(r.detail, /Unauthorized/);
});

test('gateway passes when the bytes match the sha256', async () => {
  assert.equal((await checkGateway(`${base}/good`, { cid: CID, sha256: SHA })).ok, true);
});

test('gateway fails on HTTP 200 with an HTML error page', async () => {
  const r = await checkGateway(`${base}/html`, { cid: CID, sha256: SHA });
  assert.equal(r.ok, false);
  assert.match(r.detail, /hash mismatch/);
});

test('gateway fails on 404', async () => {
  const r = await checkGateway(`${base}/missing`, { cid: CID, sha256: SHA });
  assert.equal(r.ok, false);
  assert.match(r.detail, /404/);
});

test('gateway fails on timeout', async () => {
  const r = await checkGateway(`${base}/hang`, { cid: CID, sha256: SHA, timeoutMs: 200 });
  assert.equal(r.ok, false);
  assert.match(r.detail, /timeout/);
});
