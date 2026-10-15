import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFundClient } from '../src/fund.js';
import type { FundClientConfig } from '../src/fund-types.js';
import { BaseError, ContractFunctionRevertedError } from 'viem';

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(),
  getContractEvents: vi.fn(),
  simulateContract: vi.fn(),
  writeContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

vi.mock('viem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('viem')>()),
  createPublicClient: () => mocks,
  createWalletClient: () => mocks,
}));

const hash = `0x${'a'.repeat(64)}`;
const opAddr = '0x1111111111111111111111111111111111111111';
const contractAddr = '0x2222222222222222222222222222222222222222';

const config: FundClientConfig = {
  rpcUrls: ['https://rpc.example'],
  contract: contractAddr,
  deployBlock: 100,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('ethereum', {
    request: vi.fn(async ({ method }) => {
      if (method === 'eth_requestAccounts') return [opAddr];
      return null;
    }),
  });
  mocks.writeContract.mockResolvedValue(hash);
  mocks.simulateContract.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createFundClient - views', () => {
  it('maps getStats correctly', async () => {
    mocks.readContract.mockResolvedValue([
      1000000000000000000n, // totalDonated
      500000000000000000n,  // operatorPool
      500000000000000000n,  // storageBalance
      3n,                   // epoch
      1700000000n,          // lastEpochAt
      250000000000000000n,  // lastShare
      2n,                   // operatorCount
    ]);

    const client = createFundClient(config);
    const stats = await client.getStats();

    expect(stats.totalDonated).toBe(1000000000000000000n);
    expect(stats.operatorPool).toBe(500000000000000000n);
    expect(stats.storageBalance).toBe(500000000000000000n);
    expect(stats.epoch).toBe(3n);
    expect(stats.lastEpochAt).toBe(1700000000n);
    expect(stats.lastShare).toBe(250000000000000000n);
    expect(stats.operatorCount).toBe(2n);
  });

  it('maps getOperators correctly', async () => {
    mocks.readContract.mockResolvedValue([
      ['0x1111111111111111111111111111111111111111', '0x3333333333333333333333333333333333333333'],
      ['https://node1.example.org', 'http://node2.onion'],
    ]);

    const client = createFundClient(config);
    const ops = await client.getOperators();

    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual({
      address: '0x1111111111111111111111111111111111111111',
      gateway: 'https://node1.example.org',
    });
    expect(ops[1]).toEqual({
      address: '0x3333333333333333333333333333333333333333',
      gateway: 'http://node2.onion',
    });
  });

  it('queries owed correctly', async () => {
    mocks.readContract.mockResolvedValue(50000000000000000n);

    const client = createFundClient(config);
    const owed = await client.owed(opAddr);

    expect(owed).toBe(50000000000000000n);
  });

  it('paginates and sorts getDonations and getEpochs newest first', async () => {
    mocks.getContractEvents.mockResolvedValueOnce([
      {
        args: { donor: '0xd1', amount: 100n, toOperators: 50n, toStorage: 50n, note: 'n1' },
        transactionHash: '0x1',
        blockNumber: 10n,
      },
      {
        args: { donor: '0xd2', amount: 200n, toOperators: 100n, toStorage: 100n, note: 'n2' },
        transactionHash: '0x2',
        blockNumber: 20n,
      },
      {
        args: { donor: '0xd3', amount: 300n, toOperators: 150n, toStorage: 150n, note: 'n3' },
        transactionHash: '0x3',
        blockNumber: 30n,
      },
    ]);

    const client = createFundClient(config);
    const donations = await client.getDonations({ limit: 2 });

    expect(donations).toHaveLength(2);
    // newest first
    expect(donations[0].txHash).toBe('0x3');
    expect(donations[1].txHash).toBe('0x2');
  });
});

describe('connectFundWallet - transactions & error handling', () => {
  it('throws NO_WALLET if ethereum provider is missing', async () => {
    vi.stubGlobal('ethereum', undefined);
    const client = createFundClient(config);
    await expect(client.connectFundWallet()).rejects.toMatchObject({
      code: 'NO_WALLET',
    });
  });

  describe.each([
    ['donate', (w: any) => w.donate(1000000000000000n, 'test')],
    ['registerOperator', (w: any) => w.registerOperator('https://node.org')],
    ['updateGateway', (w: any) => w.updateGateway('https://new.org')],
    ['leave', (w: any) => w.leave()],
    ['claim', (w: any) => w.claim()],
  ] as const)('%s action', (actionName, invoke) => {
    it('returns tx hash when receipt is success', async () => {
      mocks.waitForTransactionReceipt.mockResolvedValue({ status: 'success', transactionHash: hash });
      const client = createFundClient(config);
      const wallet = await client.connectFundWallet();

      await expect(invoke(wallet)).resolves.toBe(hash);
      expect(mocks.simulateContract).toHaveBeenCalled();
      expect(mocks.writeContract).toHaveBeenCalled();
    });

    it('rejects with TX_REVERTED when receipt status is reverted', async () => {
      mocks.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted', transactionHash: hash });
      const client = createFundClient(config);
      const wallet = await client.connectFundWallet();

      await expect(invoke(wallet)).rejects.toMatchObject({
        code: 'TX_REVERTED',
        detail: { status: 'reverted' },
      });
    });

    it('decodes custom contract error on simulate failure', async () => {
      const revertError = new BaseError('Execution reverted', {
        cause: new ContractFunctionRevertedError({
          abi: [] as any,
          data: { errorName: 'DonationTooSmall' } as any,
          functionName: actionName,
        }),
      });
      mocks.simulateContract.mockRejectedValue(revertError);

      const client = createFundClient(config);
      const wallet = await client.connectFundWallet();

      await expect(invoke(wallet)).rejects.toMatchObject({
        code: 'TX_REVERTED',
        message: 'DonationTooSmall',
      });
    });
  });
});
