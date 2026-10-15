import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSync, collectBooks, runSync } from './pin-sync.mjs';
import { kuboClient } from './kubo.mjs';
import { startFakeKubo } from './fake-kubo.mjs';

const book = (id, status) => ({ id, status, pdfCid: `bafypdf${id}`, metaCid: `bafymeta${id}` });

test('plan pins every pending, approved and flagged CID that is not pinned yet', () => {
  const plan = planSync([book(1, 'approved'), book(2, 'pending'), book(3, 'flagged')], new Set(['bafypdf1']));
  assert.deepEqual(plan.toPin, ['bafymeta1', 'bafypdf2', 'bafymeta2', 'bafypdf3', 'bafymeta3']);
});

test('plan unpins rejected books only when they are pinned', () => {
  const plan = planSync([book(4, 'rejected'), book(5, 'rejected')], new Set(['bafypdf4', 'bafymeta4']));
  assert.deepEqual(plan.toUnpin, ['bafypdf4', 'bafymeta4']);
  assert.deepEqual(plan.rejected.map((b) => b.id), [4, 5]);
});

test('a CID still used by a live book is never unpinned', () => {
  const rejected = { ...book(6, 'rejected'), metaCid: 'bafymeta1' };
  const plan = planSync([book(1, 'approved'), rejected], new Set(['bafypdf1', 'bafymeta1', 'bafypdf6']));
  assert.deepEqual(plan.toUnpin, ['bafypdf6']);
});

function fakeSdk({ source = 'live', catalog = [], pending = [], extra = {}, failOn } = {}) {
  return {
    async getCatalog() { return { source, books: catalog }; },
    async getPending() { return pending; },
    async getBook(id) {
      if (id === failOn) throw Object.assign(new Error('rpc down'), { code: 'UNREACHABLE' });
      if (extra[id]) return extra[id];
      throw Object.assign(new Error(`Unknown book #${id}`), { code: 'UNKNOWN_BOOK' });
    },
  };
}

test('collects approved/flagged from the catalog, pending, and the rejected gaps up to the last book', async () => {
  const sdk = fakeSdk({
    catalog: [book(1, 'approved'), book(3, 'flagged')],
    pending: [book(2, 'pending')],
    extra: { 4: book(4, 'rejected'), 5: book(5, 'rejected') },
  });
  const books = await collectBooks(sdk);
  assert.deepEqual(books.map((b) => `${b.id}:${b.status}`), ['1:approved', '2:pending', '3:flagged', '4:rejected', '5:rejected']);
});

test('refuses to work from a snapshot (stale data must never drive unpinning)', async () => {
  await assert.rejects(collectBooks(fakeSdk({ source: 'snapshot' })), /live chain data/);
});

test('any error other than UNKNOWN_BOOK aborts the collection', async () => {
  await assert.rejects(collectBooks(fakeSdk({ catalog: [book(1, 'approved')], failOn: 2 })), /rpc down/);
});

test('dry run pins what is missing and only reports what it would unpin', async () => {
  const k = await startFakeKubo({ pinned: ['bafypdf4'] });
  const removed = [];
  const r = await runSync({
    books: [book(1, 'approved'), book(4, 'rejected')], kubo: kuboClient(k.url),
    apply: false, filebase: { removeCids: async (c) => removed.push(...c) }, log: () => {},
  });
  k.close();
  assert.deepEqual(r.pinned, ['bafypdf1', 'bafymeta1']);
  assert.deepEqual(r.wouldUnpin, ['bafypdf4']);
  assert.ok(k.pins.has('bafypdf4'));
  assert.deepEqual(removed, []);
});

test('--apply unpins rejected CIDs from Kubo and Filebase', async () => {
  const k = await startFakeKubo({ pinned: ['bafypdf4', 'bafymeta4'] });
  const removed = [];
  const r = await runSync({
    books: [book(4, 'rejected')], kubo: kuboClient(k.url),
    apply: true, filebase: { removeCids: async (c) => removed.push(...c) }, log: () => {},
  });
  k.close();
  assert.deepEqual(r.unpinned, ['bafypdf4', 'bafymeta4']);
  assert.equal(k.pins.size, 0);
  assert.deepEqual(removed, ['bafypdf4', 'bafymeta4']);
});

test('one failed pin does not stop the others and is reported', async () => {
  const k = await startFakeKubo({ failPin: ['bafypdf1'] });
  const r = await runSync({ books: [book(1, 'approved')], kubo: kuboClient(k.url), apply: false, log: () => {} });
  k.close();
  assert.deepEqual(r.pinned, ['bafymeta1']);
  assert.deepEqual(r.failed.map((f) => f.cid), ['bafypdf1']);
});
