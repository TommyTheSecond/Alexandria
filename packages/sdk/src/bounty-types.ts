// TypeScript types for AlexandriaBounties (interface I9). See docs/INTERFACES.md and contracts/src/IAlexandriaBounties.sol.

export type BountyState = 'none' | 'open' | 'proposed' | 'paid' | 'cancelled';

export interface Bounty {
  id: number;
  requester: `0x${string}`;
  createdAt: number; // unix seconds
  deadline: number; // unix seconds
  state: BountyState;
  amount: bigint; // escrow still held (0 once paid)
  bookId: number; // proposed or paid book, 0 if none
  payee: `0x${string}`;
  executableAt: number; // end of the dispute window, 0 if no proposal
  title: string;
  author: string;
  language: string;
  notes: string;
  verdictCid: string;
}

export type BountyEventKind =
  | 'created' | 'funded' | 'proposed' | 'payoutCancelled' | 'paid' | 'cancelled' | 'refunded';

export interface BountyEvent {
  kind: BountyEventKind;
  bountyId: number;
  account?: `0x${string}`; // requester, funder, payee, canceller or refunded funder
  amount?: bigint;
  fee?: bigint;
  feeSent?: boolean;
  bookId?: number;
  verdictCid?: string;
  executableAt?: number;
  reason?: string;
  txHash: `0x${string}`;
  blockNumber: bigint;
}

export interface BountyConstants {
  minBounty: bigint; // 0.02 AVAX
  feeBps: number; // 500
  disputeSeconds: number;
}

/** The scanner's bounty.match verdict, parsed from the scan report check `detail` (I9). */
export interface BountyVerdict {
  bountyId: number;
  match: 'yes' | 'no' | 'unsure';
  confidence: number;
  crossChecks: boolean;
  auto: boolean; // the host proposes a payout automatically only when true
  evidence?: string;
  mismatches?: string;
  failed?: string;
  error?: string;
}

export interface NewBounty {
  title: string; // 1–200 bytes
  author: string; // 1–120 bytes
  language: string; // 2–16 bytes, e.g. "en"
  notes?: string; // <= 280 bytes, e.g. edition or translator
  deadline: number; // unix seconds, 1 hour to 90 days ahead
  amountWei: bigint; // >= minBounty
}

export interface BountyClientConfig {
  rpcUrls: readonly string[];
  contract: `0x${string}`;
  deployBlock?: bigint | number;
}

export interface BountyWalletClient {
  account: `0x${string}`;
  createBounty(bounty: NewBounty): Promise<{ txHash: `0x${string}`; id: number }>;
  addFunds(id: number, amountWei: bigint): Promise<`0x${string}`>;
  claimPayout(): Promise<`0x${string}`>;
  claimRefund(id: number): Promise<`0x${string}`>;
  /** Curators and the Safe only, during the dispute window. */
  cancelPayout(id: number, reason: string): Promise<`0x${string}`>;
}

export interface AlexandriaBountyClient {
  getConstants(): Promise<BountyConstants>;
  getBountyCount(): Promise<number>;
  getBounty(id: number): Promise<Bounty>;
  /** Newest first. */
  listBounties(opts?: { limit?: number }): Promise<Bounty[]>;
  /** Every event of one bounty, oldest first. */
  getTimeline(id: number): Promise<BountyEvent[]>;
  claimable(address: `0x${string}`): Promise<bigint>;
  contributionOf(id: number, address: `0x${string}`): Promise<bigint>;
  connectBountyWallet(walletProvider?: unknown): Promise<BountyWalletClient>;
}
