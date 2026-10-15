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
