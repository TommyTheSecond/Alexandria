import { describe, expect, it } from 'vitest';
import { resolveReaderConfig, sortPendingByScore } from './reader-config';

const endpoints = {
  rpcs: { clearnet: ['https://rpc.example'], onion: ['/rpc'] },
  gateways: { clearnet: ['https://ipfs.example'], onion: ['', 'https://ipfs.example'] },
  deployment: { address: '0x1111111111111111111111111111111111111111', deployBlock: 123 },
};

describe('reader SDK configuration', () => {
  it('uses public endpoints and disables uploads without a configured API', () => {
    const resolved = resolveReaderConfig('library.example', { apiBase: '', onion: 'abc.onion' }, endpoints);
    expect(resolved.client.rpcUrls).toEqual(['https://rpc.example']);
    expect(resolved.client.gateways).toEqual(['https://ipfs.example']);
    expect(resolved.uploadEnabled).toBe(false);
    expect(resolved.client.snapshotUrls).toEqual(['./catalog.json']);
  });

  it('uses the local RPC, gateway and scanner on the onion mirror', () => {
    const resolved = resolveReaderConfig('abc.onion', { apiBase: '', onion: 'abc.onion' }, endpoints);
    expect(resolved.client.rpcUrls).toEqual(['/rpc']);
    expect(resolved.client.gateways[0]).toBe('');
    expect(resolved.client.apiBase).toBe('/api');
    expect(resolved.uploadEnabled).toBe(true);
  });

  it('uses the deployed API endpoint for clearnet uploads', () => {
    const resolved = resolveReaderConfig('library.example', { apiBase: 'https://scanner.example/api', onion: '' }, endpoints);
    expect(resolved.client.apiBase).toBe('https://scanner.example/api');
    expect(resolved.uploadEnabled).toBe(true);
  });
});

it('puts low-scoring pending books first and keeps missing reports visible', () => {
  const books = [{ id: 3 }, { id: 1 }, { id: 2 }];
  expect(sortPendingByScore(books, { 1: 90, 2: 50 })).toEqual([books[2], books[1], books[0]]);
});
it('keeps onion uploads local even when runtime configuration contains a tunnel', () => {
 const resolved = resolveReaderConfig('abc.onion', {apiBase:'https://scanner.example/api'}, endpoints);
 expect(resolved.client.apiBase).toBe('/api');
});
