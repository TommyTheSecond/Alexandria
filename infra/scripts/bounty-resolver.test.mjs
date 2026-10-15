import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planActions, verdictFor } from './bounty-resolver.mjs';

const CID = (n) => `bafkrei${'a'.repeat(51)}${'bcdefghijklmnopq'[n]}`; // valid base32 CIDs
const PAYEE = '0x' + 'ab'.repeat(20);
const autoReport = (bountyId, auto = true) => ({
  checks: [{ id: 'bounty.match', passed: auto, severity: 'review',
    detail: JSON.stringify({ bountyId, match: auto ? 'yes' : 'no', confidence: auto ? 0.93 : 0.2, crossChecks: auto, auto }) }],
});

function world({ books, bounties, ipfs, used = [] }) {
  return {
    chain: {
      bookCount: async () => books.length,
      getBook: async (id) => books[id - 1],
      bountyCount: async () => bounties.length,
      getBounty: async (id) => { if (!bounties[id - 1]) throw new Error('UnknownBounty'); return bounties[id - 1]; },
      bookUsed: async (id) => used.includes(id),
    },
    fetchJson: async (cid) => { if (!(cid in ipfs)) throw new Error('unreachable'); return ipfs[cid]; },
  };
}

const openBounty = { state: 'open', createdAt: 100, deadline: 10_000, executableAt: 0, bookId: 0 };
const book = (n, extra = {}) => ({ metaCid: CID(n), submittedAt: 200, status: 1, ...extra });
const bountyMeta = (bountyId, reportN) => ({ title: 'Candide', bountyId, contributor: PAYEE, scanReportCid: CID(reportN) });

test('verdictFor reads the bounty.match detail for the right bounty only', () => {
  assert.equal(verdictFor(autoReport(3), 3).auto, true);
  assert.equal(verdictFor(autoReport(3), 4), null);
  assert.equal(verdictFor({ checks: [{ id: 'bounty.match', detail: 'not json' }] }, 3), null);
  assert.equal(verdictFor({}, 3), null);
});

test('proposes when the scanner says auto and the bounty is open', async () => {
  const w = world({ books: [book(1), book(2)], bounties: [openBounty],
    ipfs: { [CID(1)]: { title: 'Plain upload' }, [CID(2)]: bountyMeta(1, 9), [CID(9)]: autoReport(1) } });
  const plan = await planActions({ ...w, now: 1000 });
  assert.deepEqual(plan.proposals, [{ bountyId: 1, bookId: 2, payee: PAYEE, verdictCid: CID(9) }]);
  assert.equal(plan.nextBookId, 2);
});

test('does not propose without an automatic match or when the bounty cannot take it', async () => {
  const cases = [
    [{ [CID(1)]: bountyMeta(1, 9), [CID(9)]: autoReport(1, false) }, [openBounty], [], 'no automatic match'],
    [{ [CID(1)]: bountyMeta(1, 9), [CID(9)]: autoReport(1) }, [{ ...openBounty, state: 'proposed', bookId: 1, executableAt: 5000 }], [], 'proposed'],
    [{ [CID(1)]: bountyMeta(1, 9), [CID(9)]: autoReport(1) }, [{ ...openBounty, deadline: 500 }], [], 'deadline'],
    [{ [CID(1)]: bountyMeta(1, 9), [CID(9)]: autoReport(1) }, [{ ...openBounty, createdAt: 300 }], [], 'older'],
    [{ [CID(1)]: bountyMeta(1, 9), [CID(9)]: autoReport(1) }, [openBounty], [1], 'already paid'],
    [{ [CID(1)]: { ...bountyMeta(1, 9), contributor: 'nope' } }, [openBounty], [], 'payout address'],
    [{ [CID(1)]: bountyMeta(2, 9), [CID(9)]: autoReport(2) }, [openBounty], [], 'not found'],
  ];
  for (const [ipfs, bounties, used, note] of cases) {
    const plan = await planActions({ ...world({ books: [book(1)], bounties, ipfs, used }), now: 1000 });
    assert.deepEqual(plan.proposals, [], note);
    assert.ok(plan.notes.some((n) => n.includes(note)), `${note}: ${plan.notes}`);
  }
});

test('one proposal per bounty per round', async () => {
  const w = world({ books: [book(1), book(2)], bounties: [openBounty],
    ipfs: { [CID(1)]: bountyMeta(1, 8), [CID(2)]: bountyMeta(1, 9), [CID(8)]: autoReport(1), [CID(9)]: autoReport(1) } });
  const plan = await planActions({ ...w, now: 1000 });
  assert.equal(plan.proposals.length, 1);
  assert.equal(plan.proposals[0].bookId, 1);
});

test('stops at a book whose metadata is unreachable, to retry it next round', async () => {
  const w = world({ books: [book(1), book(2), book(3)], bounties: [], ipfs: { [CID(1)]: {}, [CID(3)]: {} } });
  const plan = await planActions({ ...w, now: 1000 });
  assert.equal(plan.nextBookId, 1);
  const next = await planActions({ ...w, now: 1000, lastBookId: 3 });
  assert.equal(next.nextBookId, 3);
});

test('executes only after the window and only for approved books', async () => {
  const proposed = (bookId) => ({ ...openBounty, state: 'proposed', executableAt: 900, bookId });
  const w = world({
    books: [book(1, { status: 2 }), book(2, { status: 1 })],
    bounties: [proposed(1), proposed(2), { ...proposed(1), executableAt: 5000 }, { ...openBounty, state: 'paid' }],
    ipfs: { [CID(1)]: {}, [CID(2)]: {} },
  });
  const plan = await planActions({ ...w, now: 1000, lastBookId: 2 });
  assert.deepEqual(plan.executions, [1]);
  assert.ok(plan.notes.some((n) => n.includes('waiting for a curator to approve book #2')));
});

test('a bounty that cannot be read does not stop the others', async () => {
  const w = world({ books: [book(1, { status: 2 })], bounties: [{ ...openBounty, state: 'proposed', executableAt: 900, bookId: 7 },
    { ...openBounty, state: 'proposed', executableAt: 900, bookId: 1 }], ipfs: { [CID(1)]: {} } });
  const plan = await planActions({ ...w, now: 1000, lastBookId: 1 });
  assert.deepEqual(plan.executions, [2]);
  assert.ok(plan.notes.some((n) => n.startsWith('bounty #1: could not be read')));
});

test('payout addresses are normalised, so a mistyped checksum still works', async () => {
  const mixed = '0x90F79bf6EB2c4F870365E785982E1f101E93b906';
  const w = world({ books: [book(1)], bounties: [openBounty],
    ipfs: { [CID(1)]: { ...bountyMeta(1, 9), contributor: mixed }, [CID(9)]: autoReport(1) } });
  const plan = await planActions({ ...w, now: 1000 });
  assert.equal(plan.proposals[0].payee, mixed.toLowerCase());
});
