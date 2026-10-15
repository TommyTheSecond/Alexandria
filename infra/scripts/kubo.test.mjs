import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kuboClient } from './kubo.mjs';
import { startFakeKubo } from './fake-kubo.mjs';

test('lists recursive pins', async () => {
  const k = await startFakeKubo({ pinned: ['bafya', 'bafyb'] });
  const pins = await kuboClient(k.url).pinnedSet();
  k.close();
  assert.deepEqual([...pins].sort(), ['bafya', 'bafyb']);
  assert.equal(k.calls[0].query.type, 'recursive');
});

test('pins and unpins by CID', async () => {
  const k = await startFakeKubo();
  const kubo = kuboClient(k.url);
  await kubo.pin('bafyx');
  assert.ok(k.pins.has('bafyx'));
  await kubo.unpin('bafyx');
  k.close();
  assert.equal(k.pins.has('bafyx'), false);
});

test('a Kubo error carries its message', async () => {
  const k = await startFakeKubo({ failPin: ['bafybad'] });
  await assert.rejects(kuboClient(k.url).pin('bafybad'), /failed to fetch bafybad/);
  k.close();
});

test('adds a file as CIDv1 and pins it', async () => {
  const k = await startFakeKubo({ addCid: 'bafysnap' });
  const cid = await kuboClient(k.url).add('latest.json', Buffer.from('{}'));
  k.close();
  assert.equal(cid, 'bafysnap');
  assert.equal(k.calls[0].query['cid-version'], '1');
  assert.equal(k.calls[0].query.pin, 'true');
  assert.match(k.calls[0].body.toString(), /name="file"; filename="latest.json"/);
});

test('exports a DAG as CAR bytes', async () => {
  const k = await startFakeKubo();
  const car = await kuboClient(k.url).dagExport('bafyroot');
  k.close();
  assert.equal(car.toString(), 'car:bafyroot');
});
