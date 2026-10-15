import {
  createPublicClient,
  fallback,
  http,
  custom,
  createWalletClient,
  type PublicClient,
  type WalletClient,
  type Hex,
  BaseError,
  ContractFunctionRevertedError,
} from 'viem';
import { avalancheFuji } from 'viem/chains';
import { alexandriaAbi } from './abi.js';
import { downloadPdf } from './download.js';
import { AlexandriaError } from './errors.js';
import { pdfFileName } from './filename.js';
import type {
  AlexandriaClient,
  Book,
  BookMeta,
  BookMetaInput,
  BookStatus,
  Catalog,
  ClientConfig,
  Hex32,
  SubmitResult,
  WalletActions,
} from './types.js';

const STATUS_MAP: Record<number, BookStatus> = {
  1: 'pending',
  2: 'approved',
  3: 'rejected',
  4: 'flagged',
};

async function fetchMetadata(
  metaCid: string,
  gateways: string[],
  timeoutMs: number = 8000
): Promise<BookMeta | null> {
  if (!metaCid) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const attempts = gateways.map(async (gw) => {
      const base = gw.endsWith('/') ? gw.slice(0, -1) : gw;
      const url = `${base}/ipfs/${metaCid}`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error('Not ok');
      return (await res.json()) as BookMeta;
    });

    const meta = await Promise.any(attempts);
    clearTimeout(timer);
    return meta;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export function createClient(config: ClientConfig): AlexandriaClient {
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

  return {
    async getCatalog(opts?: { live?: boolean }): Promise<Catalog> {
      let snapshotCatalog: Catalog | null = null;

      // 1. Try snapshot URLs in order
      if (config.snapshotUrls && config.snapshotUrls.length > 0) {
        for (const url of config.snapshotUrls) {
          try {
            const res = await fetch(url);
            if (res.ok) {
              const data = (await res.json()) as Catalog;
              if (data && Array.isArray(data.books)) {
                snapshotCatalog = { ...data, source: 'snapshot' };
                break;
              }
            }
          } catch {
            // try next snapshot url
          }
        }
      }

      // 2. Try live read if not explicitly disabled
      if (opts?.live !== false && config.rpcUrls && config.rpcUrls.length > 0) {
        try {
          const client = getPublicClient();
          const blockNumber = await client.getBlockNumber();
          const countBig = (await client.readContract({
            address: config.contract,
            abi: alexandriaAbi,
            functionName: 'bookCount',
          })) as bigint;

          const count = Number(countBig);
          const rawBooks: Book[] = [];

          const batchSize = 100;
          for (let i = 1; i <= count; i += batchSize) {
            const end = Math.min(i + batchSize - 1, count);
            const calls = [];
            for (let id = i; id <= end; id++) {
              calls.push({
                address: config.contract,
                abi: alexandriaAbi,
                functionName: 'getBook',
                args: [BigInt(id)],
              });
            }

            const results = (await client.multicall({ contracts: calls })) as {
              result?: {
                pdfCid: string;
                metaCid: string;
                pdfSha256: Hex32;
                submitter: `0x${string}`;
                submittedAt: bigint;
                status: number;
                flags: number;
                confirmed: boolean;
              };
              status: 'success' | 'failure';
            }[];

            for (let idx = 0; idx < results.length; idx++) {
              const id = i + idx;
              const item = results[idx];
              if (item.status === 'success' && item.result) {
                const r = item.result;
                const statusStr = STATUS_MAP[r.status];
                if (statusStr === 'approved' || statusStr === 'flagged') {
                  rawBooks.push({
                    id,
                    status: statusStr,
                    flags: Number(r.flags),
                    confirmed: r.confirmed,
                    submitter: r.submitter,
                    submittedAt: Number(r.submittedAt),
                    pdfCid: r.pdfCid,
                    metaCid: r.metaCid,
                    pdfSha256: r.pdfSha256 as Hex32,
                    meta: null,
                  });
                }
              }
            }
          }

          // Fetch metadata for approved/flagged books
          const booksWithMeta = await Promise.all(
            rawBooks.map(async (b) => {
              const meta = await fetchMetadata(b.metaCid, config.gateways);
              return { ...b, meta };
            })
          );

          return {
            network: 'fuji',
            chainId: 43113,
            contract: config.contract,
            atBlock: Number(blockNumber),
            generatedAt: new Date().toISOString(),
            source: 'live',
            books: booksWithMeta.sort((a, b) => a.id - b.id),
          };
        } catch {
          // Live read failed
        }
      }

      if (snapshotCatalog) {
        return snapshotCatalog;
      }

      throw new AlexandriaError(
        'UNREACHABLE',
        'Could not load catalog from RPC or snapshot'
      );
    },

    async getBook(id: number): Promise<Book> {
      if (id <= 0) {
        throw new AlexandriaError('UNKNOWN_BOOK', `Invalid book id: ${id}`);
      }

      try {
        const client = getPublicClient();
        const r = (await client.readContract({
          address: config.contract,
          abi: alexandriaAbi,
          functionName: 'getBook',
          args: [BigInt(id)],
        })) as {
          pdfCid: string;
          metaCid: string;
          pdfSha256: Hex32;
          submitter: `0x${string}`;
          submittedAt: bigint;
          status: number;
          flags: number;
          confirmed: boolean;
        };

        const statusStr = STATUS_MAP[r.status] ?? 'pending';
        const meta = await fetchMetadata(r.metaCid, config.gateways);

        return {
          id,
          status: statusStr,
          flags: Number(r.flags),
          confirmed: r.confirmed,
          submitter: r.submitter,
          submittedAt: Number(r.submittedAt),
          pdfCid: r.pdfCid,
          metaCid: r.metaCid,
          pdfSha256: r.pdfSha256 as Hex32,
          meta,
        };
      } catch (err: unknown) {
        if (err instanceof BaseError) {
          const revertError = err.walk(
            (e) => e instanceof ContractFunctionRevertedError
          ) as ContractFunctionRevertedError | null;
          if (revertError?.data?.errorName === 'UnknownBook') {
            throw new AlexandriaError('UNKNOWN_BOOK', `Unknown book #${id}`, err);
          }
        }
        throw new AlexandriaError(
          'UNREACHABLE',
          `Could not fetch book #${id}`,
          err
        );
      }
    },

    async getPending(): Promise<Book[]> {
      const client = getPublicClient();
      const countBig = (await client.readContract({
        address: config.contract,
        abi: alexandriaAbi,
        functionName: 'bookCount',
      })) as bigint;

      const count = Number(countBig);
      const pending: Book[] = [];

      for (let i = 1; i <= count; i += 100) {
        const end = Math.min(i + 99, count);
        const calls = [];
        for (let id = i; id <= end; id++) {
          calls.push({
            address: config.contract,
            abi: alexandriaAbi,
            functionName: 'getBook',
            args: [BigInt(id)],
          });
        }

        const results = (await client.multicall({ contracts: calls })) as {
          result?: {
            pdfCid: string;
            metaCid: string;
            pdfSha256: Hex32;
            submitter: `0x${string}`;
            submittedAt: bigint;
            status: number;
            flags: number;
            confirmed: boolean;
          };
          status: 'success' | 'failure';
        }[];

        for (let idx = 0; idx < results.length; idx++) {
          const id = i + idx;
          const item = results[idx];
          if (item.status === 'success' && item.result) {
            const r = item.result;
            if (STATUS_MAP[r.status] === 'pending') {
              const meta = await fetchMetadata(r.metaCid, config.gateways);
              pending.push({
                id,
                status: 'pending',
                flags: Number(r.flags),
                confirmed: r.confirmed,
                submitter: r.submitter,
                submittedAt: Number(r.submittedAt),
                pdfCid: r.pdfCid,
                metaCid: r.metaCid,
                pdfSha256: r.pdfSha256 as Hex32,
                meta,
              });
            }
          }
        }
      }

      return pending;
    },

    downloadPdf(book: Book, opts?: { onProgress?: (bytes: number) => void; signal?: AbortSignal }): Promise<Blob> {
      return downloadPdf(config.gateways, book, {
        ...opts,
        gatewayTimeoutMs: config.gatewayTimeoutMs,
      });
    },

    pdfFileName(book: Book): string {
      return pdfFileName(book);
    },

    async submit(pdf: File, meta: BookMetaInput): Promise<SubmitResult> {
      const formData = new FormData();
      formData.append('pdf', pdf);
      formData.append('meta', JSON.stringify(meta));

      let res: Response;
      try {
        res = await fetch(`${config.apiBase}/submit`, {
          method: 'POST',
          body: formData,
        });
      } catch (err) {
        throw new AlexandriaError('UNREACHABLE', 'Scanner API unreachable', err);
      }

      if (res.status === 200 || res.status === 422) {
        return (await res.json()) as SubmitResult;
      }

      let errorData: any = {};
      try {
        errorData = await res.json();
      } catch {
        // ignore
      }

      if (res.status === 409) {
        throw new AlexandriaError('DUPLICATE', 'Book duplicate', errorData);
      }
      if (res.status === 413) {
        throw new AlexandriaError('TOO_LARGE', 'PDF file exceeds 30 MB', errorData);
      }
      if (res.status === 429) {
        throw new AlexandriaError('RATE_LIMIT', 'Submission rate limit reached', errorData);
      }
      if (res.status === 400) {
        throw new AlexandriaError('INVALID_INPUT', 'Invalid input data', errorData);
      }

      throw new AlexandriaError('UNREACHABLE', `Scanner error: ${res.status}`, errorData);
    },

    async getSubmitTx(id: number): Promise<Hex32 | null> {
      const client = getPublicClient();
      const currentBlock = await client.getBlockNumber();
      let fromBlock = BigInt(config.deployBlock);
      let chunkSize = 2048n;

      while (fromBlock <= currentBlock) {
        const toBlock = fromBlock + chunkSize > currentBlock ? currentBlock : fromBlock + chunkSize;
        try {
          const logs = await client.getLogs({
            address: config.contract,
            event: {
              type: 'event',
              name: 'BookSubmitted',
              inputs: [
                { indexed: true, name: 'id', type: 'uint256' },
                { indexed: true, name: 'submitter', type: 'address' },
                { indexed: false, name: 'pdfCid', type: 'string' },
                { indexed: false, name: 'metaCid', type: 'string' },
                { indexed: false, name: 'pdfSha256', type: 'bytes32' },
              ],
            },
            args: { id: BigInt(id) },
            fromBlock,
            toBlock,
          });

          if (logs.length > 0) {
            return logs[0].transactionHash as Hex32;
          }

          fromBlock = toBlock + 1n;
        } catch {
          if (chunkSize > 128n) {
            chunkSize = chunkSize / 2n;
          } else {
            fromBlock = toBlock + 1n;
          }
        }
      }

      return null;
    },

    async connectWallet(): Promise<WalletActions> {
      const eth = (globalThis as any).ethereum;
      if (!eth) {
        throw new AlexandriaError('NO_WALLET', 'No injected wallet found');
      }

      let accounts: `0x${string}`[] = [];
      try {
        accounts = (await eth.request({ method: 'eth_requestAccounts' })) as `0x${string}`[];
      } catch (err) {
        throw new AlexandriaError('NO_WALLET', 'User rejected wallet connection', err);
      }

      if (!accounts || accounts.length === 0) {
        throw new AlexandriaError('NO_WALLET', 'No account selected');
      }

      const account = accounts[0];

      // Switch to Fuji (0xa869)
      try {
        await eth.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0xa869' }],
        });
      } catch (switchError: any) {
        if (switchError.code === 4902) {
          try {
            await eth.request({
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
        transport: custom(eth),
      });

      const pubClient = getPublicClient();

      return {
        account,
        async isCurator(): Promise<boolean> {
          try {
            const role = (await pubClient.readContract({
              address: config.contract,
              abi: alexandriaAbi,
              functionName: 'CURATOR_ROLE',
            })) as `0x${string}`;

            return (await pubClient.readContract({
              address: config.contract,
              abi: alexandriaAbi,
              functionName: 'hasRole',
              args: [role, account],
            })) as boolean;
          } catch {
            return false;
          }
        },

        async review(id: number, approve: boolean, reason: string): Promise<Hex32> {
          try {
            const hash = await walletClient.writeContract({
              address: config.contract,
              abi: alexandriaAbi,
              functionName: 'review',
              args: [BigInt(id), approve, reason],
            });

            await pubClient.waitForTransactionReceipt({ hash });
            return hash as Hex32;
          } catch (err: unknown) {
            let errorName = 'TX_REVERTED';
            if (err instanceof BaseError) {
              const revertError = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
              if (revertError?.data?.errorName) {
                errorName = revertError.data.errorName;
              }
            }
            throw new AlexandriaError('TX_REVERTED', errorName, err);
          }
        },

        async flag(id: number, reason: string): Promise<Hex32> {
          try {
            const hash = await walletClient.writeContract({
              address: config.contract,
              abi: alexandriaAbi,
              functionName: 'flag',
              args: [BigInt(id), reason],
            });

            await pubClient.waitForTransactionReceipt({ hash });
            return hash as Hex32;
          } catch (err: unknown) {
            let errorName = 'TX_REVERTED';
            if (err instanceof BaseError) {
              const revertError = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
              if (revertError?.data?.errorName) {
                errorName = revertError.data.errorName;
              }
            }
            throw new AlexandriaError('TX_REVERTED', errorName, err);
          }
        },
      };
    },
  };
}
