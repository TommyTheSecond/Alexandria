import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, encodeErrorResult, ContractFunctionRevertedError } from 'viem';
import { createBountyClient, parseBountyVerdict } from '../src/bounties.js';
import { alexandriaBountiesAbi } from '../src/bounty-abi.js';
import type { BountyClientConfig } from '../src/bounty-types.js';

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(),
  getBlockNumber: vi.fn(),
  getLogs: vi.fn(),
  simulateContract: vi.fn(),
  writeContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

vi.mock('viem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('viem')>()),
  createPublicClient: () => mocks,
  createWalletClient: () => mocks,
}));

const hash = `0x${'a'.repeat(64)}` as const;
const contract = '0x2222222222222222222222222222222222222222' as const;
const user = '0x1111111111111111111111111111111111111111' as const;
const config: BountyClientConfig = { rpcUrls: ['https://rpc.example'], contract, deployBlock: 100 };

const raw = (over: Record<string, unknown> = {}) => ({
  requester: user, createdAt: 1760000000n, deadline: 1760604800n, state: 1, amount: 2n * 10n ** 18n, bookId: 0n,
  payee: '0x0000000000000000000000000000000000000000', executableAt: 0n, title: 'Candide', author: 'Voltaire',
  language: 'en', notes: 'Smollett translation', verdictCid: '', ...over,
});

function log(eventName: string, args: Record<string, unknown>, data: `0x${string}`, block = 120n) {
  return {
    address: contract,
    topics: encodeEventTopics({ abi: alexandriaBountiesAbi, eventName, args } as never),
    data,
    transactionHash: hash,
    blockNumber: block,
  };
}

const fundedLog = (id: bigint, amount: bigint) =>
  log('BountyFunded', { id, funder: user }, encodeAbiParameters([{ type: 'uint256' }], [amount]));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('ethereum', { request: vi.fn(async ({ method }: { method: string }) => (method === 'eth_requestAccounts' ? [user] : null)) });
  mocks.simulateContract.mockResolvedValue({});
  mocks.writeContract.mockResolvedValue(hash);
});

afterEach(() => vi.unstubAllGlobals());

describe('createBountyClient reads', () => {
  it('maps getBounty and its state', async () => {
    mocks.readContract.mockResolvedValue(raw({ state: 2, bookId: 7n, executableAt: 1760000600n }));
    const b = await createBountyClient(config).getBounty(3);
    expect(b).toMatchObject({ id: 3, state: 'proposed', bookId: 7, executableAt: 1760000600, title: 'Candide', amount: 2n * 10n ** 18n });
    expect(mocks.readContract.mock.calls[0][0]).toMatchObject({ functionName: 'getBounty', args: [3n] });
  });

  it('rejects bad ids and maps UnknownBounty', async () => {
    await expect(createBountyClient(config).getBounty(0)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const data = encodeErrorResult({ abi: alexandriaBountiesAbi, errorName: 'UnknownBounty', args: [9n] });
    mocks.readContract.mockRejectedValue(new ContractFunctionRevertedError({ abi: alexandriaBountiesAbi, data, functionName: 'getBounty' }));
    await expect(createBountyClient(config).getBounty(9)).rejects.toMatchObject({ code: 'UNKNOWN_BOOK' });
  });

  it('lists newest first with a limit', async () => {
    mocks.readContract.mockImplementation(async ({ functionName, args }: { functionName: string; args: bigint[] }) =>
      functionName === 'bountyCount' ? 5n : raw({ title: `Book ${args[0]}` }));
    const list = await createBountyClient(config).listBounties({ limit: 2 });
    expect(list.map((b) => [b.id, b.title])).toEqual([[5, 'Book 5'], [4, 'Book 4']]);
  });

  it('reads constants', async () => {
    mocks.readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
      ({ MIN_BOUNTY: 2n * 10n ** 16n, BOUNTY_FEE_BPS: 500, DISPUTE_SECONDS: 600n })[functionName]);
    expect(await createBountyClient(config).getConstants()).toEqual({ minBounty: 2n * 10n ** 16n, feeBps: 500, disputeSeconds: 600 });
  });

  it('builds a timeline for one bounty only', async () => {
    mocks.getBlockNumber.mockResolvedValue(130n);
    mocks.getLogs.mockResolvedValue([fundedLog(1n, 5n), fundedLog(2n, 99n), fundedLog(1n, 7n)]);
    const timeline = await createBountyClient(config).getTimeline(1);
    expect(timeline.map((e) => [e.kind, e.amount])).toEqual([['funded', 5n], ['funded', 7n]]);
    expect(mocks.getLogs.mock.calls[0][0]).toMatchObject({ address: contract, fromBlock: 100n, toBlock: 130n });
  });
});

describe('parseBountyVerdict', () => {
  it('parses the scanner detail', () => {
    expect(parseBountyVerdict('{"bountyId":3,"match":"yes","confidence":0.93,"crossChecks":true,"auto":true,"evidence":"Candide"}'))
      .toEqual({ bountyId: 3, match: 'yes', confidence: 0.93, crossChecks: true, auto: true, evidence: 'Candide',
        mismatches: undefined, failed: undefined, error: undefined });
  });

  it('returns null for anything else', () => {
    for (const d of ['ok', '{}', '{"bountyId":"3","match":"yes"}', '{"bountyId":3,"match":"maybe"}']) {
      expect(parseBountyVerdict(d)).toBeNull();
    }
  });
});

describe('bounty wallet', () => {
  it('creates a bounty, simulating first, and returns its id from the receipt', async () => {
    const created = log('BountyCreated', { id: 4n, requester: user }, encodeAbiParameters(
      [{ type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'uint64' }, { type: 'uint256' }],
      ['Candide', 'Voltaire', 'en', '', 1760604800n, 10n ** 17n],
    ));
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: 'success', logs: [created] });
    const wallet = await createBountyClient(config).connectBountyWallet();
    const result = await wallet.createBounty({ title: 'Candide', author: 'Voltaire', language: 'en', deadline: 1760604800, amountWei: 10n ** 17n });
    expect(result).toEqual({ txHash: hash, id: 4 });
    expect(mocks.simulateContract.mock.invocationCallOrder[0]).toBeLessThan(mocks.writeContract.mock.invocationCallOrder[0]);
    expect(mocks.writeContract.mock.calls[0][0]).toMatchObject({ functionName: 'createBounty', value: 10n ** 17n });
  });

  it('throws TX_REVERTED on a reverted receipt', async () => {
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted', logs: [] });
    const wallet = await createBountyClient(config).connectBountyWallet();
    await expect(wallet.claimPayout()).rejects.toMatchObject({ code: 'TX_REVERTED' });
  });

  it('names the contract error when simulation reverts', async () => {
    const data = encodeErrorResult({ abi: alexandriaBountiesAbi, errorName: 'NothingToRefund' });
    mocks.simulateContract.mockRejectedValue(new ContractFunctionRevertedError({ abi: alexandriaBountiesAbi, data, functionName: 'claimRefund' }));
    const wallet = await createBountyClient(config).connectBountyWallet();
    await expect(wallet.claimRefund(1)).rejects.toMatchObject({ code: 'TX_REVERTED', message: 'NothingToRefund' });
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it('needs a wallet', async () => {
    vi.stubGlobal('ethereum', undefined);
    await expect(createBountyClient(config).connectBountyWallet()).rejects.toMatchObject({ code: 'NO_WALLET' });
  });
});
