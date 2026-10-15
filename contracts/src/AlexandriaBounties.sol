// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAlexandria} from "./IAlexandria.sol";
import {IAlexandriaFund} from "./IAlexandriaFund.sol";
import {IAlexandriaBounties} from "./IAlexandriaBounties.sol";

/// @notice Book bounties. The registry is only read; the fund is optional and only ever receives the 5 % fee,
/// so donations and paid nodes never depend on this contract (plan section 6).
contract AlexandriaBounties is IAlexandriaBounties, AccessControl, ReentrancyGuard {
    bytes32 public constant override RESOLVER_ROLE = keccak256("RESOLVER_ROLE");
    uint16 public constant override BOUNTY_FEE_BPS = 500;
    uint256 public constant override MIN_BOUNTY = 0.02 ether;
    uint256 public constant MIN_DEADLINE = 1 hours;
    uint256 public constant MAX_DEADLINE = 90 days;
    uint256 public constant MAX_DISPUTE_SECONDS = 7 days;

    uint256 public immutable override DISPUTE_SECONDS;
    address public immutable override registry;
    address public immutable override feeFund;

    uint256 public override bountyCount;
    uint256 public override unsentFees;
    uint256 public totalEscrow; // sum of `amount` over all bounties
    uint256 public totalClaimable;

    mapping(uint256 => Bounty) private bounties;
    mapping(uint256 => mapping(address => uint256)) private contributions;
    mapping(address => uint256) public override claimable;
    mapping(uint256 => bool) public override bookUsed;

    constructor(address admin, address resolver, address registry_, address feeFund_, uint256 disputeSeconds) {
        if (admin == address(0) || resolver == address(0) || registry_.code.length == 0) revert BadConfig();
        if (disputeSeconds > MAX_DISPUTE_SECONDS) revert BadConfig();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RESOLVER_ROLE, resolver);
        registry = registry_;
        feeFund = feeFund_;
        DISPUTE_SECONDS = disputeSeconds;
    }

    function createBounty(
        string calldata title,
        string calldata author,
        string calldata language,
        string calldata notes,
        uint64 deadline
    ) external payable override returns (uint256 id) {
        if (msg.value < MIN_BOUNTY) revert BountyTooSmall();
        checkLength(title, 1, 200);
        checkLength(author, 1, 120);
        checkLength(language, 2, 16);
        checkLength(notes, 0, 280);
        if (deadline < block.timestamp + MIN_DEADLINE || deadline > block.timestamp + MAX_DEADLINE) revert BadDeadline();

        id = ++bountyCount;
        Bounty storage b = bounties[id];
        b.requester = msg.sender;
        b.createdAt = uint64(block.timestamp);
        b.deadline = deadline;
        b.state = State.Open;
        b.amount = msg.value;
        b.title = title;
        b.author = author;
        b.language = language;
        b.notes = notes;
        contributions[id][msg.sender] = msg.value;
        totalEscrow += msg.value;
        emit BountyCreated(id, msg.sender, title, author, language, notes, deadline, msg.value);
    }

    function addFunds(uint256 id) external payable override {
        Bounty storage b = known(id);
        if (msg.value == 0) revert ZeroValue();
        if (b.state != State.Open && b.state != State.Proposed) revert NotOpen(id);
        if (block.timestamp >= b.deadline) revert DeadlinePassed(id);
        b.amount += msg.value;
        contributions[id][msg.sender] += msg.value;
        totalEscrow += msg.value;
        emit BountyFunded(id, msg.sender, msg.value);
    }

    function proposePayout(uint256 id, uint256 bookId, address payee, string calldata verdictCid)
        external
        override
        onlyRole(RESOLVER_ROLE)
    {
        Bounty storage b = known(id);
        if (b.state != State.Open) revert NotOpen(id);
        if (block.timestamp >= b.deadline) revert DeadlinePassed(id);
        if (payee == address(0)) revert BadPayee();
        checkLength(verdictCid, 1, 100);
        if (bookUsed[bookId]) revert BookAlreadyUsed(bookId);
        // Reverts with the registry's UnknownBook for a book that does not exist.
        IAlexandria.Book memory book = IAlexandria(registry).getBook(bookId);
        if (book.submittedAt < b.createdAt) revert BookTooOld(bookId);

        uint64 executableAt = uint64(block.timestamp + DISPUTE_SECONDS);
        b.state = State.Proposed;
        b.bookId = bookId;
        b.payee = payee;
        b.executableAt = executableAt;
        b.verdictCid = verdictCid;
        emit PayoutProposed(id, bookId, payee, verdictCid, executableAt);
    }

    function cancelPayout(uint256 id, string calldata reason) external override {
        if (!isCuratorOrAdmin(msg.sender)) revert NotAuthorized();
        checkLength(reason, 0, 280);
        Bounty storage b = known(id);
        if (b.state != State.Proposed) revert NotProposed(id);
        b.state = State.Open;
        b.bookId = 0;
        b.payee = address(0);
        b.executableAt = 0;
        b.verdictCid = "";
        emit PayoutCancelled(id, msg.sender, reason);
    }

    function executePayout(uint256 id) external override nonReentrant {
        Bounty storage b = known(id);
        if (b.state != State.Proposed) revert NotProposed(id);
        if (block.timestamp < b.executableAt) revert DisputeWindowActive(id, b.executableAt);
        uint256 bookId = b.bookId;
        if (bookUsed[bookId]) revert BookAlreadyUsed(bookId);
        if (IAlexandria(registry).getBook(bookId).status != IAlexandria.Status.Approved) revert BookNotApproved(bookId);

        uint256 total = b.amount;
        uint256 fee = (total * BOUNTY_FEE_BPS) / 10000;
        uint256 toPayee = total - fee;
        address payee = b.payee;

        b.state = State.Paid;
        b.amount = 0;
        bookUsed[bookId] = true;
        totalEscrow -= total;
        claimable[payee] += toPayee;
        totalClaimable += toPayee;

        bool feeSent = false;
        if (fee > 0 && feeFund.code.length > 0) {
            try IAlexandriaFund(feeFund).donate{value: fee}(string.concat("bounty #", toString(id))) {
                feeSent = true;
            } catch {}
        }
        if (!feeSent) unsentFees += fee;
        // Emitted after the fee attempt because it reports whether the fee arrived; all state is final here.
        emit PayoutExecuted(id, bookId, payee, toPayee, fee, feeSent);
    }

    function claimPayout() external override nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalClaimable -= amount;
        emit PayoutClaimed(msg.sender, amount);
        send(payable(msg.sender), amount);
    }

    function cancelBounty(uint256 id, string calldata reason) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        checkLength(reason, 0, 280);
        Bounty storage b = known(id);
        if (b.state != State.Open && b.state != State.Proposed) revert NotOpen(id);
        b.state = State.Cancelled;
        emit BountyCancelled(id, reason);
    }

    function claimRefund(uint256 id) external override nonReentrant {
        Bounty storage b = known(id);
        bool refundable = b.state == State.Cancelled || (b.state == State.Open && block.timestamp >= b.deadline);
        if (!refundable) revert NotOpen(id);
        uint256 amount = contributions[id][msg.sender];
        if (amount == 0) revert NothingToRefund();
        contributions[id][msg.sender] = 0;
        b.amount -= amount;
        totalEscrow -= amount;
        emit Refunded(id, msg.sender, amount);
        send(payable(msg.sender), amount);
    }

    function sweepFees(address payable to) external override nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert BadPayee();
        uint256 amount = unsentFees;
        if (amount == 0) revert NothingToClaim();
        unsentFees = 0;
        emit FeesSwept(to, amount);
        send(to, amount);
    }

    function getBounty(uint256 id) external view override returns (Bounty memory) {
        return known(id);
    }

    function contributionOf(uint256 id, address funder) external view override returns (uint256) {
        return contributions[id][funder];
    }

    function known(uint256 id) private view returns (Bounty storage b) {
        if (id == 0 || id > bountyCount) revert UnknownBounty(id);
        return bounties[id];
    }

    function isCuratorOrAdmin(address account) private view returns (bool) {
        if (hasRole(DEFAULT_ADMIN_ROLE, account)) return true;
        return IAccessControl(registry).hasRole(IAlexandria(registry).CURATOR_ROLE(), account);
    }

    function checkLength(string calldata text, uint256 min, uint256 max) private pure {
        uint256 length = bytes(text).length;
        if (length < min || length > max) revert BadText();
    }

    function send(address payable to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function toString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 digits = 0;
        for (uint256 v = value; v != 0; v /= 10) ++digits;
        bytes memory out = new bytes(digits);
        for (; value != 0; value /= 10) out[--digits] = bytes1(uint8(48 + (value % 10)));
        return string(out);
    }
}
