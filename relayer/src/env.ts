import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getAddress, type Abi, type Hex } from 'viem';
import type { ChainConfig } from './chain.js';

export interface RelayerConfig extends ChainConfig { secret: string; port: number }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayerConfig {
  if (!env.RELAY_SECRET || env.RELAY_SECRET.length < 32) throw new Error('RELAY_SECRET must contain at least 32 characters');
  if (!env.RELAYER_PRIVATE_KEY || !/^0x[0-9a-fA-F]{64}$/.test(env.RELAYER_PRIVATE_KEY)) {
    throw new Error('RELAYER_PRIVATE_KEY must be a testnet private key');
  }
  if (!env.RPC_URL) throw new Error('RPC_URL is required');
  let rpc: URL;
  try { rpc = new URL(env.RPC_URL); } catch { throw new Error('RPC_URL must be an HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(rpc.protocol)) throw new Error('RPC_URL must be an HTTP(S) URL');
  if (env.PORT && !/^\d+$/.test(env.PORT)) throw new Error('PORT must be a valid TCP port');
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');
  const path = resolve(env.DEPLOYMENT || '../deployments/fuji.json');
  let record: { chainId?: unknown; address?: unknown; abi?: unknown };
  try { record = JSON.parse(readFileSync(path, 'utf8')) as typeof record; }
  catch { throw new Error('DEPLOYMENT must point to a readable deployment JSON'); }
  if (record.chainId !== 43113 && record.chainId !== 31337) throw new Error('DEPLOYMENT chainId must be Fuji 43113 or Anvil 31337');
  if (typeof record.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(record.address)) throw new Error('Invalid deployment address');
  if (typeof record.abi !== 'string') throw new Error('Deployment ABI path is required');
  let abi: Abi;
  try { abi = JSON.parse(readFileSync(resolve(dirname(path), record.abi), 'utf8')) as Abi; }
  catch { throw new Error('Cannot read deployment ABI'); }
  if (!Array.isArray(abi)) throw new Error('Deployment ABI must be an array');
  return { rpcUrl: env.RPC_URL, privateKey: env.RELAYER_PRIVATE_KEY as Hex, contract: getAddress(record.address),
    chainId: record.chainId, abi, secret: env.RELAY_SECRET, port };
}
