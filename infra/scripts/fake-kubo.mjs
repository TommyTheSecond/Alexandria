// A fake Kubo RPC server for tests: keeps a pin set and records every call.
import { createServer } from 'node:http';

export async function startFakeKubo({ pinned = [], addCid = 'bafyadded', failPin = [] } = {}) {
  const pins = new Set(pinned);
  const calls = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const arg = url.searchParams.get('arg');
      calls.push({ method: req.method, path: url.pathname, arg, query: Object.fromEntries(url.searchParams), body: Buffer.concat(chunks) });
      const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method !== 'POST') return json(405, { Message: 'POST only' });
      switch (url.pathname) {
        case '/api/v0/pin/ls':
          return json(200, { Keys: Object.fromEntries([...pins].map((c) => [c, { Type: 'recursive' }])) });
        case '/api/v0/pin/add':
          if (failPin.includes(arg)) return json(500, { Message: `failed to fetch ${arg}`, Code: 0 });
          pins.add(arg);
          return json(200, { Pins: [arg] });
        case '/api/v0/pin/rm':
          if (!pins.has(arg)) return json(500, { Message: 'not pinned or pinned indirectly', Code: 0 });
          pins.delete(arg);
          return json(200, { Pins: [arg] });
        case '/api/v0/add':
          pins.add(addCid);
          return json(200, { Name: 'latest.json', Hash: addCid, Size: '10' });
        case '/api/v0/dag/export':
          res.writeHead(200, { 'content-type': 'application/vnd.ipld.car' });
          return res.end(Buffer.from(`car:${arg}`));
        default:
          return json(404, { Message: 'unknown endpoint' });
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, pins, calls, close: () => server.close() };
}
