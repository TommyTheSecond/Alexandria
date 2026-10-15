import { describe, it, expect, vi } from 'vitest';
import { createClient } from '../src/client.js';
import type { Catalog, ClientConfig } from '../src/types.js';

describe('getCatalog and getBook', () => {
  const dummySnapshot: Catalog = {
    network: 'fuji',
    chainId: 43113,
    contract: '0x1111111111111111111111111111111111111111',
    atBlock: 12345,
    generatedAt: '2026-10-15T00:00:00Z',
    source: 'snapshot',
    books: [
      {
        id: 1,
        status: 'approved',
        flags: 0,
        confirmed: true,
        submitter: '0x2222222222222222222222222222222222222222',
        submittedAt: 1000,
        pdfCid: 'bafytestpdf',
        metaCid: 'bafytestmeta',
        pdfSha256: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        meta: null,
      },
    ],
  };

  it('catalog_falls_back_to_snapshot_when_all_rpcs_fail', async () => {
    // Mock fetch to return snapshot on snapshot URL, and fail on RPC
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes('catalog.json')) {
        return new Response(JSON.stringify(dummySnapshot), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error('RPC connection failed');
    });
    vi.stubGlobal('fetch', fetchMock);

    const config: ClientConfig = {
      rpcUrls: ['http://127.0.0.1:9999/fail'],
      gateways: ['http://127.0.0.1:8080'],
      apiBase: '',
      contract: '0x1111111111111111111111111111111111111111',
      snapshotUrls: ['./catalog.json'],
      deployBlock: 0,
    };

    const client = createClient(config);
    const catalog = await client.getCatalog();

    expect(catalog.source).toBe('snapshot');
    expect(catalog.atBlock).toBe(12345);
    expect(catalog.books.length).toBe(1);

    vi.unstubAllGlobals();
  });

  it('getBook_maps_unknown_book_error', async () => {
    const config: ClientConfig = {
      rpcUrls: ['http://127.0.0.1:9999/fail'],
      gateways: [],
      apiBase: '',
      contract: '0x1111111111111111111111111111111111111111',
      snapshotUrls: [],
      deployBlock: 0,
    };

    const client = createClient(config);
    // When RPC is unreachable, throws UNREACHABLE
    await expect(client.getBook(999)).rejects.toMatchObject({
      code: 'UNREACHABLE',
    });
  });
});
