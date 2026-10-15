// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAlexandria} from "./IAlexandria.sol";

/// @notice Public-domain book registry. Flagged books remain readable and downloadable.
contract Alexandria is IAlexandria, AccessControl {
    bytes32 public constant override CURATOR_ROLE = keccak256("CURATOR_ROLE");
    bytes32 public constant override RELAYER_ROLE = keccak256("RELAYER_ROLE");
    uint32 public constant override FLAG_THRESHOLD = 3;
    uint256 public constant override MAX_PENDING_PER_SUBMITTER = 5;
    uint256 public constant MAX_CID_BYTES = 100;

    uint256 public override bookCount;
    mapping(bytes32 => uint256) public override idBySha256;
    mapping(address => uint256) public override pendingCount;
    bool public override submissionsOpen;

    mapping(uint256 => Book) private books;
    mapping(uint256 => mapping(address => bool)) public flaggedBy;
    string private latestSnapshotCid;
    uint256 private latestSnapshotBlock;

    constructor(address admin, address[] memory curators, address relayer) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        for (uint256 i; i < curators.length; ++i) {
            _grantRole(CURATOR_ROLE, curators[i]);
        }
        _grantRole(RELAYER_ROLE, relayer);
        submissionsOpen = true;
    }

    function submitBook(string calldata pdfCid, string calldata metaCid, bytes32 pdfSha256)
        external
        override
        returns (uint256 id)
    {
        if (!submissionsOpen) revert SubmissionsClosed();
        validateCid(pdfCid);
        validateCid(metaCid);
        if (pdfSha256 == bytes32(0)) revert InvalidHash();
        uint256 existingId = idBySha256[pdfSha256];
        if (existingId != 0) revert Duplicate(existingId);
        if (!hasRole(RELAYER_ROLE, msg.sender) && pendingCount[msg.sender] >= MAX_PENDING_PER_SUBMITTER) {
            revert TooManyPending(msg.sender);
        }

        id = ++bookCount;
        books[id] = Book({
            pdfCid: pdfCid,
            metaCid: metaCid,
            pdfSha256: pdfSha256,
            submitter: msg.sender,
            submittedAt: uint64(block.timestamp),
            status: Status.Pending,
            flags: 0,
            confirmed: false
        });
        idBySha256[pdfSha256] = id;
        ++pendingCount[msg.sender];
        emit BookSubmitted(id, msg.sender, pdfCid, metaCid, pdfSha256);
    }

    function review(uint256 id, bool approve, string calldata reason) external override onlyRole(CURATOR_ROLE) {
        Book storage book = knownBook(id);
        Status previous = book.status;
        if (previous != Status.Pending && previous != Status.Flagged) revert NotReviewable(id, previous);

        if (previous == Status.Pending) --pendingCount[book.submitter];
        if (approve) {
            book.status = Status.Approved;
            if (previous == Status.Flagged) book.confirmed = true;
        } else {
            book.status = Status.Rejected;
        }
        emit BookReviewed(id, msg.sender, book.status, reason);
    }

    function flag(uint256 id, string calldata reason) external override {
        Book storage book = knownBook(id);
        if (book.status != Status.Approved && book.status != Status.Flagged) revert NotFlaggable(id, book.status);
        if (flaggedBy[id][msg.sender]) revert AlreadyFlagged(id, msg.sender);

        flaggedBy[id][msg.sender] = true;
        ++book.flags;
        if (book.status == Status.Approved && !book.confirmed && book.flags >= FLAG_THRESHOLD) {
            book.status = Status.Flagged;
        }
        emit BookFlagged(id, msg.sender, book.flags, reason);
    }

    function publishSnapshot(string calldata cid, uint256 atBlock) external override onlyRole(CURATOR_ROLE) {
        validateCid(cid);
        latestSnapshotCid = cid;
        latestSnapshotBlock = atBlock;
        emit SnapshotPublished(cid, atBlock, msg.sender);
    }

    function setSubmissionsOpen(bool open) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        submissionsOpen = open;
        emit SubmissionsOpenChanged(open);
    }

    function getBook(uint256 id) external view override returns (Book memory) {
        return knownBook(id);
    }

    function latestSnapshot() external view override returns (string memory cid, uint256 atBlock) {
        return (latestSnapshotCid, latestSnapshotBlock);
    }

    function knownBook(uint256 id) private view returns (Book storage book) {
        if (id == 0 || id > bookCount) revert UnknownBook(id);
        return books[id];
    }

    function validateCid(string calldata cid) private pure {
        uint256 length = bytes(cid).length;
        if (length == 0 || length > MAX_CID_BYTES) revert InvalidCid();
    }
}
