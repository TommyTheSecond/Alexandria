import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeConfig, gatewayUrls } from './deploy-ipfs.mjs';

const base = { apiBase: '', onion: 'abc.onion', siteCid: '' };

test('runtime config keeps the committed values when no override is set', () => {
  assert.deepEqual(runtimeConfig(base, {}), base);
});

test('API_BASE from the environment overrides apiBase (the tunnel URL changes every run)', () => {
  assert.equal(runtimeConfig(base, { API_BASE: 'https://x.trycloudflare.com/api' }).apiBase, 'https://x.trycloudflare.com/api');
});

test('runtime config does not mutate the committed config', () => {
  runtimeConfig(base, { API_BASE: 'https://y/api' });
  assert.equal(base.apiBase, '');
});

test('gateway URLs: one per clearnet gateway plus the onion path', () => {
  assert.deepEqual(
    gatewayUrls('bafysite', { clearnet: ['https://ipfs.filebase.io', 'https://storry.tv'] }, 'abc.onion'),
    ['https://ipfs.filebase.io/ipfs/bafysite/', 'https://storry.tv/ipfs/bafysite/', 'http://abc.onion/ipfs/bafysite/'],
  );
});

test('gateway URLs skip the onion when there is no onion address', () => {
  assert.deepEqual(gatewayUrls('bafysite', { clearnet: ['https://storry.tv'] }, ''), ['https://storry.tv/ipfs/bafysite/']);
});
