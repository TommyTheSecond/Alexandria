// FROZEN at G0. Shared by packages/sdk (A5) and apps/reader (A4).

export type Hex32 = `0x${string}`;        // 0x + 64 lowercase hex digits
export type Address = `0x${string}`;

export type BookStatus = 'pending' | 'approved' | 'rejected' | 'flagged';
// On-chain enum index: None=0, Pending=1, Approved=2, Rejected=3, Flagged=4

export interface Person { name: string; deathYear: number | null }

export type BanScope = 'national' | 'regional' | 'import' | 'postal' | 'library' | 'school' | 'religious';

export interface BanRecord {
  country: string;               // ISO 3166-1 alpha-2, present-day country
  historicalAuthority?: string;
  authority: string;
  year: number;
  scope: BanScope;
  sourceUrl: string;
}

export interface BookMeta {
  schemaVersion: '1.0.0';
  title: string;
  authors: Person[];
  translators: Person[];
  firstPublishedYear: number;
  language: string;
  description: string;
  publicDomain: { sourceName: string; sourceUrl: string };
  bans: BanRecord[];
  pdf: { cid: string; sha256: Hex32; bytes: number; pages: number };
  submittedVia: 'web' | 'ubot' | 'direct';
  scanReportCid: string | null;
}

export type BookMetaInput = Omit<BookMeta, 'schemaVersion' | 'pdf' | 'submittedVia' | 'scanReportCid'>;

export interface Book {
  id: number;
  status: BookStatus;
  flags: number;
  confirmed: boolean;
  submitter: Address;
  submittedAt: number;           // unix seconds
  pdfCid: string;
  metaCid: string;
  pdfSha256: Hex32;
  meta: BookMeta | null;         // null if metaCid could not be fetched
}

export interface Catalog {
  network: 'fuji';
  chainId: 43113;
  contract: Address;
  atBlock: number;
  generatedAt: string;           // ISO 8601 UTC
  source: 'live' | 'snapshot';
  books: Book[];                 // approved + flagged only, sorted by id
}

export interface ScanCheck { id: string; passed: boolean; severity: 'reject' | 'review'; detail: string }

export interface ScanReport {
  schemaVersion: '1.0.0';
  pdfSha256: Hex32;
  scannerVersion: string;
  score: number;                 // 0–100
  verdict: 'pass' | 'review' | 'reject';
  checks: ScanCheck[];
  scannedAt: string;
}

export interface SubmitResult {
  report: ScanReport;
  bookId: number | null;         // null when rejected
  txHash: Hex32 | null;
  pdfCid: string | null;
  metaCid: string | null;
}

export type SdkErrorCode =
  | 'INTEGRITY' | 'UNREACHABLE' | 'DUPLICATE' | 'RATE_LIMIT' | 'TOO_LARGE' | 'INVALID_INPUT'
  | 'UNKNOWN_BOOK' | 'NO_WALLET' | 'WRONG_CHAIN' | 'TX_REVERTED';

export interface SdkError extends Error { code: SdkErrorCode; detail?: unknown }

export interface ClientConfig {
  rpcUrls: string[];             // tried in order
  gateways: string[];            // "" = same origin (onion); else "https://host"
  apiBase: string;               // scanner base URL, e.g. "/api" or "https://x.trycloudflare.com/api"
  contract: Address;
  snapshotUrls: string[];        // tried in order, e.g. ["./catalog.json"]
  deployBlock: number;           // from deployments/fuji.json; start block for getLogs
  gatewayTimeoutMs?: number;     // default 15000
}

/** Write actions. Only created by connectWallet(); reading never needs them. */
export interface WalletActions {
  account: Address;
  isCurator(): Promise<boolean>;
  /** CURATOR_ROLE only. Resolves with tx hash after 1 confirmation. Throws TX_REVERTED. */
  review(id: number, approve: boolean, reason: string): Promise<Hex32>;
  /** Anyone. Resolves with tx hash after 1 confirmation. Throws TX_REVERTED (e.g. AlreadyFlagged). */
  flag(id: number, reason: string): Promise<Hex32>;
}

export interface AlexandriaClient {
  /** Snapshot first, then live data if any RPC answers. Never throws if a snapshot loads. */
  getCatalog(opts?: { live?: boolean }): Promise<Catalog>;
  /** Live data (any status). Throws SdkError UNKNOWN_BOOK or UNREACHABLE. */
  getBook(id: number): Promise<Book>;
  /** Pending books, live only (for #/curate). */
  getPending(): Promise<Book[]>;
  /** Races gateways and verifies sha256. Throws INTEGRITY if no gateway returns matching bytes, UNREACHABLE if none answer. */
  downloadPdf(book: Book, opts?: { onProgress?: (bytes: number) => void; signal?: AbortSignal }): Promise<Blob>;
  /** "<title>-<first author>.pdf", ASCII-safe; falls back to "book-<id>.pdf". */
  pdfFileName(book: Book): string;
  /** POST /api/submit. Resolves on 200 and 422 (see report.verdict). Throws DUPLICATE (409), RATE_LIMIT (429), TOO_LARGE (413), INVALID_INPUT (400). */
  submit(pdf: File, meta: BookMetaInput): Promise<SubmitResult>;
  /** Tx hash of BookSubmitted for a book (getLogs by indexed id from deployBlock). null if not found. */
  getSubmitTx(id: number): Promise<Hex32 | null>;
  /** EIP-1193 injected wallet: request accounts, switch to Fuji (0xa869), add the chain if missing (error 4902).
   *  Throws NO_WALLET or WRONG_CHAIN. Call only after a user click. */
  connectWallet(): Promise<WalletActions>;
}

export declare function createClient(config: ClientConfig): AlexandriaClient;
