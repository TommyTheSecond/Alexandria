import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot, curateCommand, publishSnapshot } from './publish-snapshot.mjs';
import { kuboClient } from './kubo.mjs';
import { startFakeKubo } from './fake-kubo.mjs';

const snap = (over = {}) => ({ network: 'fuji', chainId: 43113, contract: '0x1', atBlock: 123, generatedAt: 'x', source: 'snapshot', books: [], ...over });

test('a valid Fuji snapshot gives its block number', () => {
  assert.equal(validateSnapshot(snap()), 123);
});

test('rejects anything that is not a Fuji snapshot catalog', () => {
  assert.throws(() => validateSnapshot(snap({ chainId: 43114 })), /chainId/);
  assert.throws(() => validateSnapshot(snap({ source: 'live' })), /source/);
  assert.throws(() => validateSnapshot(snap({ atBlock: -1 })), /atBlock/);
  assert.throws(() => validateSnapshot(snap({ books: null })), /books/);
});

test('prints the curator command; A6 never signs it', () => {
  assert.equal(curateCommand('bafysnap', 123), 'contracts/script/curate.sh snapshot bafysnap 123');
});

test('adds the snapshot to Kubo as CIDv1 and uploads the same CID to Filebase', async () => {
  const k = await startFakeKubo({ addCid: 'bafysnap' });
  const uploads = [];
  const r = await publishSnapshot({
    bytes: Buffer.from(JSON.stringify(snap())),
    kubo: kuboClient(k.url),
    upload: async (key, car) => { uploads.push([key, car.toString()]); return 'bafysnap'; },
  });
  k.close();
  assert.deepEqual(r, { cid: 'bafysnap', atBlock: 123, command: 'contracts/script/curate.sh snapshot bafysnap 123' });
  assert.deepEqual(uploads, [['snapshots/bafysnap.car', 'car:bafysnap']]);
});

test('a Filebase CID mismatch fails loudly', async () => {
  const k = await startFakeKubo({ addCid: 'bafysnap' });
  await assert.rejects(
    publishSnapshot({ bytes: Buffer.from(JSON.stringify(snap())), kubo: kuboClient(k.url), upload: async () => 'bafyother' }),
    /bafyother/,
  );
  k.close();
});

test('an invalid snapshot is never added to Kubo', async () => {
  const k = await startFakeKubo();
  await assert.rejects(publishSnapshot({ bytes: Buffer.from('{"chainId":1}'), kubo: kuboClient(k.url) }));
  k.close();
  assert.equal(k.calls.length, 0);
});
