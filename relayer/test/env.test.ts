import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { generatePrivateKey } from 'viem/accounts';
import { loadConfig } from '../src/env.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture(chainId = 31337): NodeJS.ProcessEnv {
  const directory = mkdtempSync(join(tmpdir(), 'alexandria-relayer-test-'));
  directories.push(directory);
  const deployment = join(directory, 'deployment.json');
  writeFileSync(join(directory, 'abi.json'), '[]');
  writeFileSync(deployment, JSON.stringify({ chainId, address: '0x0000000000000000000000000000000000000001', abi: 'abi.json' }));
  return { RPC_URL: 'http://127.0.0.1:8545', RELAYER_PRIVATE_KEY: generatePrivateKey(),
    RELAY_SECRET: randomBytes(32).toString('hex'), DEPLOYMENT: deployment };
}

it('loads_only_supported_testnet_deployments', () => {
  expect(loadConfig(fixture()).chainId).toBe(31337);
  expect(loadConfig(fixture(43113)).chainId).toBe(43113);
  expect(() => loadConfig(fixture(43114))).toThrow('Fuji 43113 or Anvil 31337');
});

it('rejects_invalid_secrets_keys_ports_and_rpc_without_echoing_values', () => {
  const env = fixture();
  expect(() => loadConfig({ ...env, RELAY_SECRET: '' })).toThrow('RELAY_SECRET');
  expect(() => loadConfig({ ...env, RELAYER_PRIVATE_KEY: '' })).toThrow('RELAYER_PRIVATE_KEY');
  expect(() => loadConfig({ ...env, PORT: '8787extra' })).toThrow('PORT');
  expect(() => loadConfig({ ...env, PORT: '0' })).toThrow('PORT');
  expect(() => loadConfig({ ...env, RPC_URL: 'file:///tmp' })).toThrow('HTTP(S)');
});
