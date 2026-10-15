import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getAddress, type Abi } from 'viem';
import type { ChainConfig } from './chain.js';
import type { KeystoreConfig } from './keystore.js';

export interface RelayerConfig extends Omit<ChainConfig, 'privateKey'>, KeystoreConfig { secret: string; port: number }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayerConfig {
  if (!env.RELAY_SECRET || env.RELAY_SECRET.length < 32) throw new Error('RELAY_SECRET must contain at least 32 characters');
  if (env.RELAYER_PRIVATE_KEY) throw new Error('RELAYER_PRIVATE_KEY is no longer accepted; use RELAYER_KEYSTORE');
  if (!env.RELAYER_KEYSTORE) throw new Error('RELAYER_KEYSTORE must point to the encrypted relayer JSON file');
  if (!env.RPC_URL) throw new Error('RPC_URL is required');
  let rpc: URL;
  try { rpc = new URL(env.RPC_URL); } catch { throw new Error('RPC_URL must be an HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(rpc.protocol)) throw new Error('RPC_URL must be an HTTP(S) URL');
  if (env.PORT && !/^\d+$/.test(env.PORT)) throw new Error('PORT must be a valid TCP port');
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');
  const path = resolve(env.DEPLOYMENT || '../deployments/fuji.json');
  let record: { chainId?: unknown; address?: unknown; abi?: unknown; relayer?: unknown };
  try { record = JSON.parse(readFileSync(path, 'utf8')) as typeof record; }
  catch { throw new Error('DEPLOYMENT must point to a readable deployment JSON'); }
  if (record.chainId !== 43113 && record.chainId !== 31337) throw new Error('DEPLOYMENT chainId must be Fuji 43113 or Anvil 31337');
  if (typeof record.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(record.address)) throw new Error('Invalid deployment address');
  if (typeof record.relayer !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(record.relayer)) throw new Error('Deployment relayer address is required');
  if (typeof record.abi !== 'string') throw new Error('Deployment ABI path is required');
  let abi: Abi;
  try { abi = JSON.parse(readFileSync(resolve(dirname(path), record.abi), 'utf8')) as Abi; }
  catch { throw new Error('Cannot read deployment ABI'); }
  if (!Array.isArray(abi)) throw new Error('Deployment ABI must be an array');
  return { rpcUrl: env.RPC_URL, keystorePath: resolve(env.RELAYER_KEYSTORE),
    passwordFile: env.RELAYER_PASSWORD_FILE ? resolve(env.RELAYER_PASSWORD_FILE) : undefined,
    expectedRelayer: getAddress(record.relayer), contract: getAddress(record.address),
    chainId: record.chainId, abi, secret: env.RELAY_SECRET, port };
}
