import {
  createPublicClient,
  fallback,
  http,
  custom,
  createWalletClient,
  type PublicClient,
  type Hex,
  BaseError,
  ContractFunctionRevertedError,
} from 'viem';
import { avalancheFuji } from 'viem/chains';
import { alexandriaFundAbi } from './fund-abi.js';
import { AlexandriaError } from './errors.js';
import type {
  AlexandriaFundClient,
  FundClientConfig,
  FundStats,
  OperatorInfo,
  DonatedEvent,
  EpochClosedEvent,
  StorageSpentEvent,
  FundWalletClient,
} from './fund-types.js';

export function createFundClient(config: FundClientConfig): AlexandriaFundClient {
  let publicClient: PublicClient | null = null;

  function getPublicClient(): PublicClient {
    if (!publicClient) {
      if (!config.rpcUrls || config.rpcUrls.length === 0) {
        throw new AlexandriaError('UNREACHABLE', 'No RPC URLs configured');
      }
      const transports = config.rpcUrls.map((url) =>
        http(url, { timeout: 8000 })
      );
      publicClient = createPublicClient({
        chain: avalancheFuji,
        transport: fallback(transports),
      });
    }
    return publicClient;
  }

  const deployBlockBigInt = config.deployBlock !== undefined ? BigInt(config.deployBlock) : 0n;

  return {
    async getStats(): Promise<FundStats> {
      const client = getPublicClient();
      const res = (await client.readContract({
        address: config.contract,
        abi: alexandriaFundAbi,
        functionName: 'stats',
      })) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint];

      return {
        totalDonated: res[0],
        operatorPool: res[1],
        storageBalance: res[2],
        epoch: res[3],
        lastEpochAt: res[4],
        lastShare: res[5],
        operatorCount: res[6],
      };
    },

    async getOperators(): Promise<OperatorInfo[]> {
      const client = getPublicClient();
      const [operators, gateways] = (await client.readContract({
        address: config.contract,
        abi: alexandriaFundAbi,
        functionName: 'operatorList',
      })) as [readonly `0x${string}`[], readonly string[]];

      return operators.map((address, idx) => ({
        address,
        gateway: gateways[idx],
      }));
    },

    async owed(address: `0x${string}`): Promise<bigint> {
      const client = getPublicClient();
      return (await client.readContract({
        address: config.contract,
        abi: alexandriaFundAbi,
        functionName: 'owed',
        args: [address],
      })) as bigint;
    },

    async getDonations(opts?: { limit?: number; fromBlock?: bigint }): Promise<DonatedEvent[]> {
      const client = getPublicClient();
      const from = opts?.fromBlock ?? deployBlockBigInt;

      const logs = await client.getContractEvents({
        address: config.contract,
        abi: alexandriaFundAbi,
        eventName: 'Donated',
        fromBlock: from,
      });

      const events: DonatedEvent[] = logs.map((log) => ({
        donor: (log.args as any).donor,
        amount: (log.args as any).amount,
        toOperators: (log.args as any).toOperators,
        toStorage: (log.args as any).toStorage,
        note: (log.args as any).note ?? '',
        txHash: log.transactionHash as `0x${string}`,
        blockNumber: log.blockNumber ?? 0n,
      }));

      events.reverse();
      if (opts?.limit && opts.limit > 0) {
        return events.slice(0, opts.limit);
      }
      return events;
    },

    async getEpochs(opts?: { limit?: number; fromBlock?: bigint }): Promise<EpochClosedEvent[]> {
      const client = getPublicClient();
      const from = opts?.fromBlock ?? deployBlockBigInt;

      const logs = await client.getContractEvents({
        address: config.contract,
        abi: alexandriaFundAbi,
        eventName: 'EpochClosed',
        fromBlock: from,
      });

      const events: EpochClosedEvent[] = logs.map((log) => ({
        epoch: (log.args as any).epoch,
        activeCount: (log.args as any).activeCount,
        sharePerOperator: (log.args as any).sharePerOperator,
        reportCid: (log.args as any).reportCid ?? '',
        txHash: log.transactionHash as `0x${string}`,
        blockNumber: log.blockNumber ?? 0n,
      }));

      events.reverse();
      if (opts?.limit && opts.limit > 0) {
        return events.slice(0, opts.limit);
      }
      return events;
    },

    async getStorageSpends(opts?: { limit?: number; fromBlock?: bigint }): Promise<StorageSpentEvent[]> {
      const client = getPublicClient();
      const from = opts?.fromBlock ?? deployBlockBigInt;

      const logs = await client.getContractEvents({
        address: config.contract,
        abi: alexandriaFundAbi,
        eventName: 'StorageSpent',
        fromBlock: from,
      });

      const events: StorageSpentEvent[] = logs.map((log) => ({
        to: (log.args as any).to,
        amount: (log.args as any).amount,
        memo: (log.args as any).memo ?? '',
        txHash: log.transactionHash as `0x${string}`,
        blockNumber: log.blockNumber ?? 0n,
      }));

      events.reverse();
      if (opts?.limit && opts.limit > 0) {
        return events.slice(0, opts.limit);
      }
      return events;
    },

    async connectFundWallet(walletProvider?: unknown): Promise<FundWalletClient> {
      const eth = walletProvider ?? (globalThis as any).ethereum;
      if (!eth) {
        throw new AlexandriaError('NO_WALLET', 'No injected wallet found');
      }

      let accounts: `0x${string}`[] = [];
      try {
        accounts = (await (eth as any).request({ method: 'eth_requestAccounts' })) as `0x${string}`[];
      } catch (err) {
        throw new AlexandriaError('NO_WALLET', 'User rejected wallet connection', err);
      }

      if (!accounts || accounts.length === 0) {
        throw new AlexandriaError('NO_WALLET', 'No account selected');
      }

      const account = accounts[0];

      // Switch to Fuji (0xa869)
      try {
        await (eth as any).request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0xa869' }],
        });
      } catch (switchError: any) {
        if (switchError?.code === 4902) {
          try {
            await (eth as any).request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: '0xa869',
                  chainName: 'Avalanche Fuji Testnet',
                  rpcUrls: config.rpcUrls,
                  nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
                  blockExplorerUrls: ['https://testnet.snowtrace.io'],
                },
              ],
            });
          } catch (addError) {
            throw new AlexandriaError('WRONG_CHAIN', 'Failed to add Fuji network', addError);
          }
        } else {
          throw new AlexandriaError('WRONG_CHAIN', 'Failed to switch to Fuji network', switchError);
        }
      }

      const walletClient = createWalletClient({
        account,
        chain: avalancheFuji,
        transport: custom(eth as any),
      });

      const pubClient = getPublicClient();

      async function executeWrite(
        fnName: string,
        args: unknown[],
        value?: bigint
      ): Promise<`0x${string}`> {
        try {
          // Rule 5: simulate first
          const simArgs: any = {
            address: config.contract,
            abi: alexandriaFundAbi,
            functionName: fnName,
            args,
            account,
          };
          if (value !== undefined) {
            simArgs.value = value;
          }
          await pubClient.simulateContract(simArgs);

          const writeArgs: any = {
            address: config.contract,
            abi: alexandriaFundAbi,
            functionName: fnName,
            args,
          };
          if (value !== undefined) {
            writeArgs.value = value;
          }
          const hash = await walletClient.writeContract(writeArgs);

          // Check receipt status === 'success'
          const receipt = await pubClient.waitForTransactionReceipt({ hash });
          if (receipt.status !== 'success') {
            throw new AlexandriaError('TX_REVERTED', 'Transaction reverted', receipt);
          }
          return hash;
        } catch (err: unknown) {
          if (err instanceof AlexandriaError) throw err;
          let errorName = 'TX_REVERTED';
          if (err && typeof err === 'object') {
            if ('walk' in err && typeof (err as any).walk === 'function') {
              const revertError = (err as any).walk(
                (e: any) => e instanceof ContractFunctionRevertedError || e?.name === 'ContractFunctionRevertedError'
              );
              if (revertError?.data?.errorName) {
                errorName = revertError.data.errorName;
              } else if ((revertError as any)?.raw?.errorName) {
                errorName = (revertError as any).raw.errorName;
              }
            }
            if (errorName === 'TX_REVERTED' && (err as any).data?.errorName) {
              errorName = (err as any).data.errorName;
            } else if (errorName === 'TX_REVERTED' && (err as any).raw?.errorName) {
              errorName = (err as any).raw.errorName;
            }
          }
          throw new AlexandriaError('TX_REVERTED', errorName, err);
        }
      }

      return {
        async donate(amountWei: bigint, note: string = ''): Promise<`0x${string}`> {
          return executeWrite('donate', [note], amountWei);
        },

        async registerOperator(gateway: string): Promise<`0x${string}`> {
          return executeWrite('registerOperator', [gateway]);
        },

        async updateGateway(gateway: string): Promise<`0x${string}`> {
          return executeWrite('updateGateway', [gateway]);
        },

        async leave(): Promise<`0x${string}`> {
          return executeWrite('leave', []);
        },

        async claim(): Promise<`0x${string}`> {
          return executeWrite('claim', []);
        },
      };
    },
  };
}
