# Alexandria: frozen interfaces (I1–I7)

**Status:** draft until gate G0 (H+2), frozen after it. To change anything here, open a PR labelled `rfc`, get approval from all 4 people, and bump the version.

At G0, P4 (a human) copies I1–I4 verbatim into their real files in **one** PR, `rfc/g0-interfaces`. All 4 people review it, and P4 merges it by H+1:30. Agents never create these files.

| ID | Real file | Created by |
|---|---|---|
| I1 | `contracts/src/IAlexandria.sol` | P4 (G0 PR) |
| I2 | `schemas/book.schema.json` | P4 (G0 PR) |
| I3 | `schemas/scan-report.schema.json` | P4 (G0 PR) |
| I4 | `packages/sdk/src/types.ts` | P4 (G0 PR) |
| I5, I6 | stay in this file (HTTP contracts) | none |
| I7 | `deployments/fuji.json` and `deployments/abi/IAlexandria.json` | A1 (after the G0 PR) |

Formats used everywhere:
- **Hashes:** lowercase hex with a `0x` prefix and 64 hex digits.
- **CIDs:** CIDv1 base32, at most 100 characters.
- **Times:** unix seconds on-chain; ISO 8601 UTC strings in JSON.

---

## I1: Contract interface (`contracts/src/IAlexandria.sol`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Alexandria: registry of public-domain banned books
/// @notice FROZEN at G0. Book ids start at 1. 0 means "no book".
interface IAlexandria {
    enum Status { None, Pending, Approved, Rejected, Flagged }

    struct Book {
        string pdfCid;       // CIDv1 of the PDF
        string metaCid;      // CIDv1 of the book.schema.json document
        bytes32 pdfSha256;   // sha256 of the PDF bytes
        address submitter;   // msg.sender (the relayer for web uploads)
        uint64 submittedAt;  // block.timestamp
        Status status;
        uint32 flags;        // number of distinct flagging addresses
        bool confirmed;      // true after a curator re-approves a Flagged book
    }

    error SubmissionsClosed();
    error InvalidCid();                          // empty or longer than 100 bytes
    error InvalidHash();                         // pdfSha256 == 0
    error Duplicate(uint256 existingId);
    error TooManyPending(address submitter);     // non-relayer with 5 Pending books
    error UnknownBook(uint256 id);
    error NotReviewable(uint256 id, Status status);
    error NotFlaggable(uint256 id, Status status);
    error AlreadyFlagged(uint256 id, address flagger);

    event BookSubmitted(uint256 indexed id, address indexed submitter, string pdfCid, string metaCid, bytes32 pdfSha256);
    event BookReviewed(uint256 indexed id, address indexed curator, Status status, string reason);
    event BookFlagged(uint256 indexed id, address indexed flagger, uint32 flags, string reason);
    event SnapshotPublished(string cid, uint256 atBlock, address indexed curator);
    event SubmissionsOpenChanged(bool open);

    function CURATOR_ROLE() external view returns (bytes32);              // keccak256("CURATOR_ROLE")
    function RELAYER_ROLE() external view returns (bytes32);              // keccak256("RELAYER_ROLE")
    function FLAG_THRESHOLD() external view returns (uint32);             // 3
    function MAX_PENDING_PER_SUBMITTER() external view returns (uint256); // 5 (RELAYER_ROLE is exempt)

    /// Anyone. Reverts: SubmissionsClosed, InvalidCid, InvalidHash, Duplicate, TooManyPending.
    /// Effect: new id = bookCount + 1, status Pending, pendingCount[sender]++.
    function submitBook(string calldata pdfCid, string calldata metaCid, bytes32 pdfSha256) external returns (uint256 id);

    /// CURATOR_ROLE. Allowed from Pending or Flagged, else NotReviewable.
    /// approve: Pending -> Approved, or Flagged -> Approved with confirmed = true.
    /// reject:  Pending or Flagged -> Rejected (final).
    /// Leaving Pending decrements pendingCount[submitter].
    function review(uint256 id, bool approve, string calldata reason) external;

    /// Anyone, once per address per book. Allowed on Approved or Flagged, else NotFlaggable.
    /// flags++. If status == Approved && !confirmed && flags >= FLAG_THRESHOLD, status becomes Flagged.
    /// A Flagged book stays downloadable; the UI only labels it "under review".
    function flag(uint256 id, string calldata reason) external;

    /// CURATOR_ROLE. Records the CID of the latest catalog snapshot.
    function publishSnapshot(string calldata cid, uint256 atBlock) external;

    /// DEFAULT_ADMIN_ROLE (the 3-of-4 Safe). Emergency stop for spam floods.
    function setSubmissionsOpen(bool open) external;

    function getBook(uint256 id) external view returns (Book memory);   // UnknownBook if id == 0 or id > bookCount
    function bookCount() external view returns (uint256);
    function idBySha256(bytes32 pdfSha256) external view returns (uint256); // 0 if none
    function pendingCount(address submitter) external view returns (uint256);
    function submissionsOpen() external view returns (bool);
    function latestSnapshot() external view returns (string memory cid, uint256 atBlock);
}
```

Implementation constructor (not part of the interface):
`constructor(address admin, address[] memory curators, address relayer)`. It sets `submissionsOpen = true`, uses OpenZeppelin `AccessControl` 5.x, and has no upgrade proxy and no delete function.

---

## I2: Book metadata (`schemas/book.schema.json`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "alexandria/book.schema.json",
  "title": "Alexandria book metadata",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "title", "authors", "translators", "firstPublishedYear", "language", "description", "publicDomain", "bans", "pdf", "submittedVia", "scanReportCid"],
  "properties": {
    "schemaVersion": { "const": "1.0.0" },
    "title": { "type": "string", "minLength": 1, "maxLength": 300 },
    "authors": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/person" } },
    "translators": { "type": "array", "items": { "$ref": "#/$defs/person" } },
    "firstPublishedYear": { "type": "integer", "minimum": -3000, "maximum": 2026 },
    "language": { "type": "string", "pattern": "^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$" },
    "description": { "type": "string", "maxLength": 1000 },
    "publicDomain": {
      "type": "object",
      "additionalProperties": false,
      "required": ["sourceName", "sourceUrl"],
      "properties": {
        "sourceName": { "type": "string", "minLength": 1, "maxLength": 100 },
        "sourceUrl": { "type": "string", "pattern": "^https://", "maxLength": 500 }
      }
    },
    "bans": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/ban" } },
    "pdf": {
      "type": "object",
      "additionalProperties": false,
      "required": ["cid", "sha256", "bytes", "pages"],
      "properties": {
        "cid": { "type": "string", "pattern": "^baf[a-z2-7]{20,97}$" },
        "sha256": { "type": "string", "pattern": "^0x[0-9a-f]{64}$" },
        "bytes": { "type": "integer", "minimum": 1, "maximum": 31457280 },
        "pages": { "type": "integer", "minimum": 1 }
      }
    },
    "submittedVia": { "enum": ["web", "ubot", "direct"] },
    "scanReportCid": { "type": ["string", "null"], "pattern": "^baf[a-z2-7]{20,97}$" },
    "bountyId": { "type": "integer", "minimum": 1, "description": "optional: the I9 bounty this upload answers" },
    "contributor": { "type": "string", "pattern": "^0x[0-9a-fA-F]{40}$", "description": "optional: address paid if the bounty pays out (public)" }
  },
  "$defs": {
    "person": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "deathYear"],
      "properties": {
        "name": { "type": "string", "minLength": 1, "maxLength": 200 },
        "deathYear": { "type": ["integer", "null"], "maximum": 2026, "description": "null = unknown or living; sends the book to review" }
      }
    },
    "ban": {
      "type": "object",
      "additionalProperties": false,
      "required": ["country", "authority", "year", "scope", "sourceUrl"],
      "properties": {
        "country": { "type": "string", "pattern": "^[A-Z]{2}$", "description": "ISO 3166-1 alpha-2 of the present-day country" },
        "historicalAuthority": { "type": "string", "maxLength": 200, "description": "e.g. Russian Empire, Qing dynasty" },
        "authority": { "type": "string", "minLength": 1, "maxLength": 200 },
        "year": { "type": "integer", "minimum": -3000, "maximum": 2026 },
        "scope": { "enum": ["national", "regional", "import", "postal", "library", "school", "religious"] },
        "sourceUrl": { "type": "string", "pattern": "^https://", "maxLength": 500 }
      }
    }
  }
}
```

The uploader sends **`BookMetaInput`**: every field except `schemaVersion`, `pdf`, `submittedVia` and `scanReportCid`. The scanner fills those in.

`bountyId` and `contributor` are optional and only used by bounty uploads (I9); every other upload stays exactly as before.

---

## I3: Scan report (`schemas/scan-report.schema.json`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "alexandria/scan-report.schema.json",
  "title": "Alexandria scan report",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "pdfSha256", "scannerVersion", "score", "verdict", "checks", "scannedAt"],
  "properties": {
    "schemaVersion": { "const": "1.0.0" },
    "pdfSha256": { "type": "string", "pattern": "^0x[0-9a-f]{64}$" },
    "scannerVersion": { "type": "string" },
    "score": { "type": "integer", "minimum": 0, "maximum": 100 },
    "verdict": { "enum": ["pass", "review", "reject"] },
    "checks": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "passed", "severity", "detail"],
        "properties": {
          "id": { "type": "string", "description": "check id from README section 6, e.g. pdf.active" },
          "passed": { "type": "boolean" },
          "severity": { "enum": ["reject", "review"] },
          "detail": { "type": "string", "maxLength": 500 }
        }
      }
    },
    "scannedAt": { "type": "string", "format": "date-time" }
  }
}
```

---

## I4: SDK types (`packages/sdk/src/types.ts`)

```ts
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
```

---

## I5: Scanner HTTP API (A3 serves it; A5 and the U-bot ingest call it)

Base: `http://127.0.0.1:8000`, exposed as `/api` through Caddy (onion) and a Cloudflare quick tunnel (clearnet). CORS: `Access-Control-Allow-Origin: *`, no credentials.

| Method + path | Request | Responses |
|---|---|---|
| `GET /api/health` | none | `200 {"ok": true, "scannerVersion": "x.y.z"}` |
| `POST /api/scan` | `multipart/form-data`: `pdf` (file), `meta` (JSON string, `BookMetaInput`) | `200 ScanReport` (scan only, nothing stored) |
| `POST /api/submit` | same as `/api/scan`, plus optional `via` = `web` (default) or `ubot` | `200 SubmitResult` (verdict pass or review; pinned and relayed) · `422 SubmitResult` (verdict reject; nothing stored) · `409 {"code":"DUPLICATE","existingId":n}` · `413 {"code":"TOO_LARGE"}` · `429 {"code":"RATE_LIMIT","retryAfterSec":n}` · `400 {"code":"INVALID_INPUT","detail":"..."}` |
| `GET /api/report/{sha256}` | path: `0x…` hash | `200 ScanReport` · `404` |

`/api/submit` steps, in order:
1. Scan the PDF.
2. Fill in `pdf`, `submittedVia` and `schemaVersion`.
3. Pin the scan report, then the PDF, then the metadata to Filebase and Kubo. That order gives `scanReportCid` before the metadata is pinned.
4. `POST /relay`.
5. Return `SubmitResult`.

---

## I6: Relayer HTTP API (A2 serves it; only the scanner calls it)

Listens on `127.0.0.1:8787` only. Every request needs the header `X-Relay-Secret: <RELAY_SECRET from .env>`.

| Method + path | Request | Responses |
|---|---|---|
| `GET /health` | none | `200 {"ok": true, "address": "0x…", "balanceWei": "…", "sentToday": n}` |
| `POST /relay` | `{"pdfCid": "...", "metaCid": "...", "pdfSha256": "0x…"}` | `200 {"bookId": n, "txHash": "0x…"}` (after 1 confirmation) · `401` bad secret · `409 {"code":"DUPLICATE","existingId":n}` · `429 {"code":"DAILY_CAP"}` (200 tx/day) · `502 {"code":"CHAIN_ERROR","detail":"..."}` |

---

## I7: Deployment record (`deployments/fuji.json`, written by A1)

```json
{
  "network": "fuji",
  "chainId": 43113,
  "address": "0x…",
  "deployBlock": 0,
  "deployTx": "0x…",
  "admin": "0x… (Safe, or deployer until handover)",
  "curators": ["0x…", "0x…", "0x…", "0x…"],
  "relayer": "0x…",
  "abi": "abi/IAlexandria.json",
  "explorer": "https://testnet.snowtrace.io/address/0x…"
}
```

`deployments/anvil.json` has the same shape for local runs (chainId `31337`).

---

## I9: Book bounties (`contracts/src/IAlexandriaBounties.sol`)

The contract interface is the Solidity file itself; the ABI is `deployments/abi/IAlexandriaBounties.json`. Design and isolation rules: `docs/agents/donation-nodes-plan.md` sections 5 and 6.

- **Lifecycle:** `createBounty` (escrow, ≥ 0.02 AVAX) → `addFunds` → `proposePayout` (host signer, `RESOLVER_ROLE`) → dispute window `DISPUTE_SECONDS` (600 on Fuji) during which a curator or the Safe may `cancelPayout` → `executePayout` (anyone; the registry book must be `Approved`) → 95 % `claimPayout` by the contributor, 5 % to `AlexandriaFund.donate`. If the fee can't be delivered (no fund, fund reverts), the payout still happens and the fee waits in `unsentFees` for the Safe (`sweepFees`).
- **Refunds:** `claimRefund` after `cancelBounty` (Safe) or once the deadline passes while the bounty is still Open.
- **Uploads:** an upload answers a bounty with the optional I2 fields `bountyId` and `contributor`.
- **Scanner:** a bounty upload gets the check `bounty.match` (severity `review`, never `reject`); its `detail` is compact JSON `{"bountyId":n,"match":"yes|no|unsure","confidence":0–1,"crossChecks":true|false,"evidence":"…"}`.
- **Deployment record** `deployments/fuji-bounties.json`:

```json
{
  "network": "fuji",
  "chainId": 43113,
  "address": "0x…",
  "deployBlock": 0,
  "deployTx": "0x…",
  "registry": "0x… (I7 address)",
  "fund": "0x… or 0x0000000000000000000000000000000000000000",
  "disputeSeconds": 600,
  "abi": "abi/IAlexandriaBounties.json",
  "explorer": "https://testnet.snowtrace.io/address/0x…"
}
```
