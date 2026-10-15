// TypeScript types for AlexandriaFund (Interface I8)

export interface FundStats {
  totalDonated: bigint;
  operatorPool: bigint;
  storageBalance: bigint;
  epoch: bigint;
  lastEpochAt: bigint;
  lastShare: bigint;
  operatorCount: bigint;
}

export interface OperatorInfo {
  address: `0x${string}`;
  gateway: string;
}

export interface DonatedEvent {
  donor: `0x${string}`;
  amount: bigint;
  toOperators: bigint;
  toStorage: bigint;
  note: string;
  txHash: `0x${string}`;
  blockNumber: bigint;
  timestamp?: number;
}

export interface EpochClosedEvent {
  epoch: bigint;
  activeCount: bigint;
  sharePerOperator: bigint;
  reportCid: string;
  txHash: `0x${string}`;
  blockNumber: bigint;
  timestamp?: number;
}

export interface StorageSpentEvent {
  to: `0x${string}`;
  amount: bigint;
  memo: string;
  txHash: `0x${string}`;
  blockNumber: bigint;
  timestamp?: number;
}

export interface FundDeployment {
  address: `0x${string}`;
  deployBlock: bigint | number;
  abi?: readonly unknown[];
  attester: `0x${string}`;
  minEpochSeconds: number;
}

export interface FundClientConfig {
  rpcUrls: readonly string[];
  contract: `0x${string}`;
  deployBlock?: bigint | number;
}

export interface FundWalletClient {
  donate(amountWei: bigint, note?: string): Promise<`0x${string}`>;
  registerOperator(gateway: string): Promise<`0x${string}`>;
  updateGateway(gateway: string): Promise<`0x${string}`>;
  leave(): Promise<`0x${string}`>;
  claim(): Promise<`0x${string}`>;
}

export interface AlexandriaFundClient {
  getStats(): Promise<FundStats>;
  getOperators(): Promise<OperatorInfo[]>;
  owed(address: `0x${string}`): Promise<bigint>;
  getDonations(opts?: { limit?: number; fromBlock?: bigint }): Promise<DonatedEvent[]>;
  getEpochs(opts?: { limit?: number; fromBlock?: bigint }): Promise<EpochClosedEvent[]>;
  getStorageSpends(opts?: { limit?: number; fromBlock?: bigint }): Promise<StorageSpentEvent[]>;
  connectFundWallet(walletProvider?: unknown): Promise<FundWalletClient>;
}
