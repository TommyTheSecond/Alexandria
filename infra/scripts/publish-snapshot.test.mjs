import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { validateSnapshot, curateCommand, publishSnapshot, snapshotPath, buildArgs } from './publish-snapshot.mjs';
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

test('the host can keep its snapshot outside the committed file', () => {
  const committed = snapshotPath({});
  assert.match(committed, /[/\\]snapshots[/\\]latest\.json$/);
  assert.deepEqual(buildArgs(committed), ['--filter', '@alexandria/sdk', 'run', 'build-snapshot']);
  const target = resolve('/tmp/alexandria-host/latest.json');
  const host = snapshotPath({ SNAPSHOT_FILE: target });
  assert.equal(host, target);
  assert.deepEqual(buildArgs(host).slice(-2), ['--out', target]);
});

test('replaces older snapshot copies on Filebase only after the new one is confirmed', async () => {
  const k = await startFakeKubo({ addCid: 'bafysnap' });
  const calls = [];
  const r = await publishSnapshot({
    bytes: Buffer.from(JSON.stringify(snap())),
    kubo: kuboClient(k.url),
    upload: async (key) => { calls.push(['upload', key]); return 'bafysnap'; },
    prune: async (keep) => { calls.push(['prune', keep]); return ['snapshots/bafyold.car']; },
  });
  assert.deepEqual(calls, [['upload', 'snapshots/bafysnap.car'], ['prune', 'snapshots/bafysnap.car']]);
  assert.deepEqual(r.pruned, ['snapshots/bafyold.car']);
  // A mismatched upload never prunes; a failing prune never fails the publish.
  calls.length = 0;
  await assert.rejects(publishSnapshot({ bytes: Buffer.from(JSON.stringify(snap())), kubo: kuboClient(k.url),
    upload: async () => 'bafyother', prune: async (keep) => { calls.push(keep); return []; } }), /bafyother/);
  assert.deepEqual(calls, []);
  const ok = await publishSnapshot({ bytes: Buffer.from(JSON.stringify(snap())), kubo: kuboClient(k.url),
    upload: async () => 'bafysnap', prune: async () => { throw new Error('HTTP 503'); } });
  assert.equal(ok.cid, 'bafysnap');
  k.close();
});
