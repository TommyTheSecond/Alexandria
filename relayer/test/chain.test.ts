import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer as reservePort, type Server } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPublicClient, createTestClient, createWalletClient, http, type Abi, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { createChainGateway, type ChainConfig } from '../src/chain.js';
import { createRelayerServer, listenLoopback } from '../src/server.js';

const artifactPath = resolve('../contracts/out/Alexandria.sol/Alexandria.json');
const anvilAvailable = spawnSync('anvil', ['--version'], { stdio: 'ignore' }).status === 0;

describe.skipIf(!anvilAvailable || !existsSync(artifactPath))('real Anvil integration', () => {
  let process: ChildProcess;
  let server: HttpServer;
  let config: ChainConfig;
  let base: string;
  const secret = randomBytes(32).toString('hex');
  const cid = 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const request = (n: number) => fetch(`${base}/relay`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-secret': secret },
    body: JSON.stringify({ pdfCid: cid, metaCid: cid,
      pdfSha256: `0x${createHash('sha256').update(`anvil-fixture-${n}`).digest('hex')}` }),
  });

  beforeAll(async () => {
    const reservation: Server = reservePort();
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('Cannot reserve local port');
    const port = address.port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    process = spawn('anvil', ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337', '--silent'], { stdio: 'ignore' });
    const rpcUrl = `http://127.0.0.1:${port}`;
    const publicClient = createPublicClient({ chain: foundry, transport: http(rpcUrl, { retryCount: 0, timeout: 200 }) });
    let ready = false;
    for (let attempt = 0; attempt < 100; ++attempt) {
      try { await publicClient.getChainId(); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    if (!ready) throw new Error('Anvil did not start');
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const testClient = createTestClient({ chain: foundry, mode: 'anvil', transport: http(rpcUrl) });
    await testClient.setBalance({ address: account.address, value: 100n * 10n ** 18n });
    const wallet = createWalletClient({ account, chain: foundry, transport: http(rpcUrl) });
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as { abi: Abi; bytecode: { object: Hex } };
    const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object,
      args: [account.address, [account.address], account.address] });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error('Local deployment failed');
    config = { rpcUrl, chainId: 31337, contract: receipt.contractAddress, privateKey,
      abi: JSON.parse(readFileSync('../deployments/abi/IAlexandria.json', 'utf8')) as Abi };
    const gateway = await createChainGateway(config);
    server = createRelayerServer({ secret, gateway });
    await listenLoopback(server, 0);
    const listening = server.address();
    if (!listening || typeof listening === 'string') throw new Error('No relayer port');
    base = `http://127.0.0.1:${listening.port}`;
  }, 30_000);

  afterAll(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    process?.kill();
  });

  it('rejects_a_mismatched_rpc_chain_before_listening', async () => {
    await expect(createChainGateway({ ...config, chainId: 43113 })).rejects.toThrow('chain IDs do not match');
  });

  it('submits_five_concurrent_transactions_with_distinct_ids_and_no_nonce_errors', async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, (_, i) => request(i)));
    expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200, 200]);
    const results = await Promise.all(responses.map(response => response.json())) as { bookId: number; txHash: Hex }[];
    expect(new Set(results.map(result => result.bookId)).size).toBe(5);
    expect(results.every(result => /^0x[0-9a-f]{64}$/.test(result.txHash))).toBe(true);
    const duplicate = await request(0);
    expect(duplicate.status).toBe(409);
  }, 30_000);

  it('decodes_contract_revert_names_without_leaking_rpc_details', async () => {
    const wallet = createWalletClient({ account: privateKeyToAccount(config.privateKey), chain: foundry, transport: http(config.rpcUrl) });
    const hash = await wallet.writeContract({ address: config.contract, abi: config.abi,
      functionName: 'setSubmissionsOpen', args: [false] });
    const publicClient = createPublicClient({ chain: foundry, transport: http(config.rpcUrl) });
    await publicClient.waitForTransactionReceipt({ hash });
    const result = await request(99);
    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({ code: 'CHAIN_ERROR', detail: 'SubmissionsClosed' });
  }, 30_000);
});
