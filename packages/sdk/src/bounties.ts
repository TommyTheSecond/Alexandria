// Client for AlexandriaBounties (I9). Separate from the fund client on purpose: neither imports the other
// (docs/agents/donation-nodes-plan.md section 6).
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  fallback,
  http,
  ContractFunctionRevertedError,
  type PublicClient,
} from 'viem';
import { avalancheFuji } from 'viem/chains';
import { alexandriaBountiesAbi } from './bounty-abi.js';
import { AlexandriaError } from './errors.js';
import type {
  AlexandriaBountyClient,
  Bounty,
  BountyClientConfig,
  BountyConstants,
  BountyEvent,
  BountyState,
  BountyVerdict,
  BountyWalletClient,
  NewBounty,
} from './bounty-types.js';

const STATES: BountyState[] = ['none', 'open', 'proposed', 'paid', 'cancelled'];
const LOG_CHUNK = 2048n;

type RawBounty = {
  requester: `0x${string}`; createdAt: bigint; deadline: bigint; state: number; amount: bigint; bookId: bigint;
  payee: `0x${string}`; executableAt: bigint; title: string; author: string; language: string; notes: string;
  verdictCid: string;
};

function toBounty(id: number, r: RawBounty): Bounty {
  return {
    id,
    requester: r.requester,
    createdAt: Number(r.createdAt),
    deadline: Number(r.deadline),
    state: STATES[Number(r.state)] ?? 'none',
    amount: r.amount,
    bookId: Number(r.bookId),
    payee: r.payee,
    executableAt: Number(r.executableAt),
    title: r.title,
    author: r.author,
    language: r.language,
    notes: r.notes,
    verdictCid: r.verdictCid,
  };
}

/** Parses the scanner's `bounty.match` check detail (compact JSON); null if it isn't one. */
export function parseBountyVerdict(detail: string): BountyVerdict | null {
  try {
    const v = JSON.parse(detail) as Partial<BountyVerdict>;
    if (!v || typeof v.bountyId !== 'number' || !['yes', 'no', 'unsure'].includes(String(v.match))) return null;
    return {
      bountyId: v.bountyId,
      match: v.match as BountyVerdict['match'],
      confidence: typeof v.confidence === 'number' ? v.confidence : 0,
      crossChecks: v.crossChecks === true,
      auto: v.auto === true,
      evidence: typeof v.evidence === 'string' ? v.evidence : undefined,
      mismatches: typeof v.mismatches === 'string' ? v.mismatches : undefined,
      failed: typeof v.failed === 'string' ? v.failed : undefined,
      error: typeof v.error === 'string' ? v.error : undefined,
    };
  } catch {
    return null;
  }
}

function revertName(err: unknown): string {
  if (err && typeof err === 'object' && 'walk' in err && typeof (err as { walk: unknown }).walk === 'function') {
    const found = (err as { walk: (fn: (e: unknown) => boolean) => unknown }).walk(
      (e) => e instanceof ContractFunctionRevertedError,
    ) as ContractFunctionRevertedError | null;
    if (found?.data?.errorName) return found.data.errorName;
  }
  return 'TX_REVERTED';
}

export function createBountyClient(config: BountyClientConfig): AlexandriaBountyClient {
  let publicClient: PublicClient | null = null;
  const deployBlock = BigInt(config.deployBlock ?? 0);

  function pub(): PublicClient {
    if (!publicClient) {
      if (!config.rpcUrls?.length) throw new AlexandriaError('UNREACHABLE', 'No RPC URLs configured');
      publicClient = createPublicClient({
        chain: avalancheFuji,
        transport: fallback(config.rpcUrls.map((url) => http(url, { timeout: 8000 }))),
      }) as PublicClient;
    }
    return publicClient;
  }

  async function read<T>(functionName: string, args: unknown[] = []): Promise<T> {
    try {
      return (await pub().readContract({
        address: config.contract, abi: alexandriaBountiesAbi, functionName, args,
      } as never)) as T;
    } catch (err) {
      const name = revertName(err);
      if (name === 'UnknownBounty') throw new AlexandriaError('UNKNOWN_BOOK', `Unknown bounty`, err);
      throw new AlexandriaError('UNREACHABLE', `Could not read ${functionName}`, err);
    }
  }

  const client: AlexandriaBountyClient = {
    async getConstants(): Promise<BountyConstants> {
      const [minBounty, feeBps, dispute] = await Promise.all([
        read<bigint>('MIN_BOUNTY'), read<number | bigint>('BOUNTY_FEE_BPS'), read<bigint>('DISPUTE_SECONDS'),
      ]);
      return { minBounty, feeBps: Number(feeBps), disputeSeconds: Number(dispute) };
    },

    async getBountyCount(): Promise<number> {
      return Number(await read<bigint>('bountyCount'));
    },

    async getBounty(id: number): Promise<Bounty> {
      if (!Number.isSafeInteger(id) || id <= 0) throw new AlexandriaError('INVALID_INPUT', `Invalid bounty id ${id}`);
      return toBounty(id, await read<RawBounty>('getBounty', [BigInt(id)]));
    },

    async listBounties(opts?: { limit?: number }): Promise<Bounty[]> {
      const count = await client.getBountyCount();
      const limit = Math.min(count, Math.max(1, opts?.limit ?? 50));
      const ids = Array.from({ length: limit }, (_, i) => count - i);
      return Promise.all(ids.map((id) => client.getBounty(id)));
    },
    async getTimeline(id: number): Promise<BountyEvent[]> {
      const latest = await pub().getBlockNumber();
      const events: BountyEvent[] = [];
      const startBlock = deployBlock > 0n ? deployBlock : (latest > LOG_CHUNK * 10n ? latest - LOG_CHUNK * 10n : 0n);
      for (let from = startBlock; from <= latest; from += LOG_CHUNK) {
        const to = from + LOG_CHUNK - 1n > latest ? latest : from + LOG_CHUNK - 1n;
        const logs = await pub().getLogs({ address: config.contract, fromBlock: from, toBlock: to });
        for (const log of logs) {
          let decoded: { eventName: string; args: Record<string, unknown> };
          try {
            decoded = decodeEventLog({ abi: alexandriaBountiesAbi, data: log.data, topics: log.topics }) as never;
          } catch {
            continue;
          }
          const a = decoded.args;
          if (a.id === undefined || Number(a.id) !== id) continue;
          const base = { bountyId: id, txHash: log.transactionHash as `0x${string}`, blockNumber: log.blockNumber ?? 0n };
          switch (decoded.eventName) {
            case 'BountyCreated':
              events.push({ ...base, kind: 'created', account: a.requester as `0x${string}`, amount: a.amount as bigint }); break;
            case 'BountyFunded':
              events.push({ ...base, kind: 'funded', account: a.funder as `0x${string}`, amount: a.amount as bigint }); break;
            case 'PayoutProposed':
              events.push({ ...base, kind: 'proposed', account: a.payee as `0x${string}`, bookId: Number(a.bookId),
                verdictCid: a.verdictCid as string, executableAt: Number(a.executableAt) }); break;
            case 'PayoutCancelled':
              events.push({ ...base, kind: 'payoutCancelled', account: a.by as `0x${string}`, reason: a.reason as string }); break;
            case 'PayoutExecuted':
              events.push({ ...base, kind: 'paid', account: a.payee as `0x${string}`, bookId: Number(a.bookId),
                amount: a.toPayee as bigint, fee: a.fee as bigint, feeSent: a.feeSent as boolean }); break;
            case 'BountyCancelled':
              events.push({ ...base, kind: 'cancelled', reason: a.reason as string }); break;
            case 'Refunded':
              events.push({ ...base, kind: 'refunded', account: a.funder as `0x${string}`, amount: a.amount as bigint }); break;
          }
        }
      }
      return events;
    },

    async claimable(address: `0x${string}`): Promise<bigint> {
      return read<bigint>('claimable', [address]);
    },

    async contributionOf(id: number, address: `0x${string}`): Promise<bigint> {
      return read<bigint>('contributionOf', [BigInt(id), address]);
    },

    async connectBountyWallet(walletProvider?: unknown): Promise<BountyWalletClient> {
      const eth = (walletProvider ?? (globalThis as { ethereum?: unknown }).ethereum) as
        | { request(args: { method: string; params?: unknown[] }): Promise<unknown> }
        | undefined;
      if (!eth) throw new AlexandriaError('NO_WALLET', 'No injected wallet found');
      let accounts: `0x${string}`[];
      try {
        accounts = (await eth.request({ method: 'eth_requestAccounts' })) as `0x${string}`[];
      } catch (err) {
        throw new AlexandriaError('NO_WALLET', 'Wallet connection was rejected', err);
      }
      if (!accounts?.length) throw new AlexandriaError('NO_WALLET', 'No account selected');
      const account = accounts[0];
      try {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa869' }] });
      } catch (switchError) {
        if ((switchError as { code?: number })?.code !== 4902) {
          throw new AlexandriaError('WRONG_CHAIN', 'Failed to switch to Fuji', switchError);
        }
        try {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0xa869', chainName: 'Avalanche Fuji Testnet', rpcUrls: config.rpcUrls,
              nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
              blockExplorerUrls: ['https://testnet.snowtrace.io'],
            }],
          });
        } catch (addError) {
          throw new AlexandriaError('WRONG_CHAIN', 'Failed to add Fuji', addError);
        }
      }
      const wallet = createWalletClient({ account, chain: avalancheFuji, transport: custom(eth) });

      async function write(functionName: string, args: unknown[], value?: bigint) {
        try {
          const request = { address: config.contract, abi: alexandriaBountiesAbi, functionName, args, account, value };
          await pub().simulateContract(request as never); // decoded revert reason before the wallet asks to sign
          const hash = await wallet.writeContract(request as never);
          const receipt = await pub().waitForTransactionReceipt({ hash });
          if (receipt.status !== 'success') throw new AlexandriaError('TX_REVERTED', 'Transaction reverted', receipt);
          return { hash, receipt };
        } catch (err) {
          if (err instanceof AlexandriaError) throw err;
          throw new AlexandriaError('TX_REVERTED', revertName(err), err);
        }
      }

      return {
        account,
        async createBounty(b: NewBounty) {
          const { hash, receipt } = await write(
            'createBounty', [b.title, b.author, b.language, b.notes ?? '', BigInt(b.deadline)], b.amountWei,
          );
          let id = 0;
          for (const log of receipt.logs) {
            if (log.address.toLowerCase() !== config.contract.toLowerCase()) continue;
            try {
              const ev = decodeEventLog({ abi: alexandriaBountiesAbi, data: log.data, topics: log.topics }) as never as {
                eventName: string; args: { id?: bigint };
              };
              if (ev.eventName === 'BountyCreated' && ev.args.id !== undefined) id = Number(ev.args.id);
            } catch { /* not ours */ }
          }
          return { txHash: hash, id };
        },
        async addFunds(id: number, amountWei: bigint) {
          return (await write('addFunds', [BigInt(id)], amountWei)).hash;
        },
        async claimPayout() {
          return (await write('claimPayout', [])).hash;
        },
        async claimRefund(id: number) {
          return (await write('claimRefund', [BigInt(id)])).hash;
        },
        async cancelPayout(id: number, reason: string) {
          return (await write('cancelPayout', [BigInt(id), reason])).hash;
        },
      };
    },
  };
  return client;
}
