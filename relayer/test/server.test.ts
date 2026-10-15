import { createHash, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';
import { createRelayerServer, listenLoopback } from '../src/server.js';
import { ChainFailure, type ChainGateway, type RelayInput } from '../src/chain.js';

const cid = 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const digest = (n: number): Hex => `0x${createHash('sha256').update(`fixture-${n}`).digest('hex')}`;
const input = (n = 1): RelayInput => ({ pdfCid: cid, metaCid: cid, pdfSha256: digest(n) });
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error ? reject(error) : resolve());
  })));
});

async function fixture(cap = 200, now: () => number = Date.now) {
  const secret = randomBytes(32).toString('hex');
  const books = new Map<Hex, number>();
  let count = 0;
  let active = 0;
  let maxActive = 0;
  const gateway: ChainGateway = {
    address: '0x0000000000000000000000000000000000000001' as Address,
    getBalance: vi.fn(async () => 2n * 10n ** 18n),
    existingId: vi.fn(async hash => books.get(hash) ?? 0),
    submit: vi.fn(async request => {
      maxActive = Math.max(maxActive, ++active);
      await new Promise(resolve => setTimeout(resolve, 5));
      const bookId = ++count;
      books.set(request.pdfSha256, bookId);
      --active;
      return { bookId, txHash: digest(bookId + 100) };
    }),
  };
  const server = createRelayerServer({ secret, gateway, dailyLimit: cap, now });
  servers.push(server);
  await listenLoopback(server, 0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test listener');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (body: unknown = input(), auth: string | null = secret) => fetch(`${base}/relay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth === null ? {} : { 'x-relay-secret': auth }) },
    body: JSON.stringify(body),
  });
  return { server, gateway, request, base, secret, books, maxActive: () => maxActive };
}

describe('I6 relayer HTTP API', () => {
  it('rejects_missing_or_wrong_secret', async () => {
    const f = await fixture();
    expect((await f.request(input(), null)).status).toBe(401);
    expect((await f.request(input(), 'invalid')).status).toBe(401);
    expect((await fetch(`${f.base}/health`)).status).toBe(401);
    expect(f.gateway.submit).not.toHaveBeenCalled();
  });

  it('rejects_bad_cid_and_bad_hash', async () => {
    const f = await fixture();
    for (const body of [null, [], {}, { ...input(), pdfCid: 'https://bad' },
      { ...input(), metaCid: 'QmWrongVersion' }, { ...input(), pdfSha256: '0xABC' },
      { ...input(), pdfSha256: `0x${'0'.repeat(64)}` }, { ...input(), extra: 'bad' }]) {
      expect((await f.request(body)).status).toBe(400);
    }
    expect(f.gateway.submit).not.toHaveBeenCalled();
  });

  it('returns_409_on_duplicate', async () => {
    const f = await fixture();
    expect((await f.request()).status).toBe(200);
    const duplicate = await f.request();
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ code: 'DUPLICATE', existingId: 1 });
    expect(f.gateway.submit).toHaveBeenCalledTimes(1);
  });

  it('returns_409_when_duplicate_races_past_existing_id_check', async () => {
    const f = await fixture();
    vi.mocked(f.gateway.submit).mockRejectedValueOnce(new ChainFailure('Duplicate', 7));
    const result = await f.request();
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ code: 'DUPLICATE', existingId: 7 });
    const health = await fetch(`${f.base}/health`, { headers: { 'x-relay-secret': f.secret } });
    expect((await health.json() as { sentToday: number }).sentToday).toBe(0);
  });

  it('submits_and_returns_bookId_and_txHash', async () => {
    const f = await fixture();
    const result = await f.request();
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ bookId: 1, txHash: digest(101) });
  });

  it('serialises_concurrent_requests', async () => {
    const f = await fixture();
    const responses = await Promise.all(Array.from({ length: 5 }, (_, i) => f.request(input(i))));
    expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200, 200]);
    const bodies = await Promise.all(responses.map(response => response.json())) as { bookId: number }[];
    expect(new Set(bodies.map(body => body.bookId)).size).toBe(5);
    expect(f.maxActive()).toBe(1);
  });

  it('serialises_duplicate_checks_with_submissions', async () => {
    const f = await fixture();
    const responses = await Promise.all([f.request(), f.request()]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(f.gateway.submit).toHaveBeenCalledTimes(1);
  });

  it('returns_429_after_daily_cap', async () => {
    const f = await fixture(2);
    await f.request(input(1));
    await f.request(input(2));
    const result = await f.request(input(3));
    expect(result.status).toBe(429);
    expect(await result.json()).toEqual({ code: 'DAILY_CAP' });
  });

  it('resets_cap_at_midnight_utc', async () => {
    let now = Date.parse('2026-10-15T23:59:59Z');
    const f = await fixture(1, () => now);
    expect((await f.request(input(1))).status).toBe(200);
    expect((await f.request(input(2))).status).toBe(429);
    now += 1000;
    expect((await f.request(input(2))).status).toBe(200);
  });

  it('health_reports_balance_and_sentToday', async () => {
    const f = await fixture();
    await f.request();
    const result = await fetch(`${f.base}/health`, { headers: { 'x-relay-secret': f.secret } });
    expect(await result.json()).toEqual({ ok: true, address: f.gateway.address, balanceWei: '2000000000000000000', sentToday: 1 });
  });

  it('listens_on_loopback_only', async () => {
    const f = await fixture();
    expect(f.server.address()).toMatchObject({ address: '127.0.0.1' });
  });

  it('returns_safe_chain_errors_without_request_or_secret_details', async () => {
    const f = await fixture(1);
    vi.mocked(f.gateway.submit).mockRejectedValueOnce(new Error(`RPC failed ${f.secret}`));
    const result = await f.request();
    expect(result.status).toBe(502);
    expect(await result.text()).not.toContain(f.secret);
    const health = await fetch(`${f.base}/health`, { headers: { 'x-relay-secret': f.secret } });
    expect((await health.json() as { sentToday: number }).sentToday).toBe(0);
    expect((await f.request(input(2))).status).toBe(200);
    expect((await f.request(input(3))).status).toBe(429);
  });

  it('bounds_request_size', async () => {
    const f = await fixture();
    expect((await f.request({ ...input(), extra: 'x'.repeat(5000) })).status).toBe(400);
  });
});
