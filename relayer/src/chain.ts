import { createPublicClient, createWalletClient, decodeEventLog, getAddress, http, type Abi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji, foundry } from 'viem/chains';

export interface RelayInput { pdfCid: string; metaCid: string; pdfSha256: Hex }
export interface RelayResult { bookId: number; txHash: Hex }
export interface ChainGateway {
  address: Address;
  getBalance(): Promise<bigint>;
  existingId(hash: Hex): Promise<number>;
  submit(input: RelayInput): Promise<RelayResult>;
}
export class ChainFailure extends Error {
  constructor(readonly detail: string, readonly duplicateId?: number) { super(detail); }
}
export class ChainStartupError extends Error {}

export interface ChainConfig {
  rpcUrl: string;
  chainId: 43113 | 31337;
  contract: Address;
  privateKey: Hex;
  abi: Abi;
}

function safeId(value: unknown): number {
  if (typeof value !== 'bigint' || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ChainFailure('Invalid book ID returned by chain');
  }
  return Number(value);
}

/** Keep only decoded contract data safe to return through the relayer API. */
export function decodeChainFailure(error: unknown): ChainFailure {
  if (error instanceof ChainFailure) return error;
  let cause: unknown = error;
  for (let i = 0; i < 12 && cause && typeof cause === 'object'; ++i) {
    const item = cause as { data?: { errorName?: unknown; args?: unknown }; cause?: unknown };
    const name = item.data?.errorName;
    if (typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(name)) {
      if (name === 'Duplicate' && Array.isArray(item.data?.args)) {
        const id = item.data.args[0];
        if (typeof id === 'bigint' && id > 0n && id <= BigInt(Number.MAX_SAFE_INTEGER)) {
          return new ChainFailure('Duplicate', Number(id));
        }
      }
      return new ChainFailure(name);
    }
    cause = item.cause;
  }
  return new ChainFailure('Chain request failed');
}

/** Initialize only after matching the RPC network to the deployment record. */
export async function createChainGateway(config: ChainConfig): Promise<ChainGateway> {
  if (config.chainId !== 43113 && config.chainId !== 31337) throw new ChainStartupError('Only Fuji or local Anvil is allowed');
  const chain = config.chainId === 43113 ? avalancheFuji : foundry;
  const account = privateKeyToAccount(config.privateKey);
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl, { timeout: 15_000, retryCount: 0 }) });
  if (await publicClient.getChainId() !== config.chainId) throw new ChainStartupError('Deployment and RPC chain IDs do not match');
  const code = await publicClient.getBytecode({ address: config.contract });
  if (!code || code === '0x') throw new ChainStartupError('No contract deployed at DEPLOYMENT address');
  const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl, { timeout: 15_000, retryCount: 0 }) });

  return {
    address: account.address,
    getBalance: () => publicClient.getBalance({ address: account.address }),
    existingId: async hash => safeId(await publicClient.readContract({
      address: config.contract, abi: config.abi, functionName: 'idBySha256', args: [hash],
    })),
    async submit(input) {
      try {
        const { request } = await publicClient.simulateContract({
          address: config.contract, abi: config.abi, functionName: 'submitBook',
          args: [input.pdfCid, input.metaCid, input.pdfSha256], account,
        });
        const txHash = await wallet.writeContract(request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1, timeout: 120_000 });
        if (receipt.status !== 'success') throw new ChainFailure('Transaction reverted');
        for (const log of receipt.logs) {
          if (getAddress(log.address) !== getAddress(config.contract)) continue;
          try {
            const event = decodeEventLog({ abi: config.abi, eventName: 'BookSubmitted', data: log.data, topics: log.topics });
            const args: unknown = event.args;
            if (!args || typeof args !== 'object' || !('id' in args)) throw new ChainFailure('Invalid submission event');
            const bookId = safeId(args.id);
            if (bookId < 1) throw new ChainFailure('Invalid submitted book ID');
            return { bookId, txHash };
          } catch (error) {
            if (error instanceof ChainFailure) throw error;
          }
        }
        throw new ChainFailure('BookSubmitted event missing from receipt');
      } catch (error) {
        throw decodeChainFailure(error);
      }
    },
  };
}
