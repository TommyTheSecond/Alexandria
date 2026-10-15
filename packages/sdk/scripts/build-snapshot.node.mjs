import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotFromCatalog } from './build-snapshot.mjs';

const contract = '0x1111111111111111111111111111111111111111';
const blockTime = 1_760_486_400;
const live = {
  network: 'fuji', chainId: 43113, contract, atBlock: 42,
  generatedAt: '2026-10-15T00:00:00.000Z', source: 'live',
  books: [{ id: 3, status: 'flagged', meta: { title: 'Third' } },
    { id: 1, status: 'approved', meta: { title: 'First' } }],
};

test('writes only approved and flagged books in ID order with snapshot provenance', () => {
  const snapshot = snapshotFromCatalog(live, contract, blockTime);
  assert.equal(snapshot.source, 'snapshot');
  assert.deepEqual(snapshot.books.map(book => book.id), [1, 3]);
  assert.equal(snapshot.atBlock, 42);
  assert.equal(live.source, 'live');
});

test('refuses stale fallback data and a different deployment', () => {
  assert.throws(() => snapshotFromCatalog({ ...live, source: 'snapshot' }, contract, blockTime), /live/);
  assert.throws(() => snapshotFromCatalog(live, '0x2222222222222222222222222222222222222222', blockTime), /contract/);
});

test('does not replace a good snapshot with incomplete metadata', () => {
  assert.throws(() => snapshotFromCatalog({ ...live, books: [{ id: 1, status: 'approved', meta: null }] }, contract, blockTime), /metadata/);
});

test('same block state produces byte-identical snapshots', () => {
  const first = snapshotFromCatalog(live, contract, blockTime);
  const second = snapshotFromCatalog({ ...live, generatedAt: '2099-01-01T00:00:00Z' }, contract, blockTime);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.generatedAt, new Date(blockTime * 1000).toISOString());
});
