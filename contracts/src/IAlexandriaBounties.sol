// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice I9: book bounties. Escrowed test AVAX for a specific public-domain book, paid to whoever uploads it,
/// after an AI match, a curator-approved book and a dispute window. See docs/agents/donation-nodes-plan.md section 5.
interface IAlexandriaBounties {
    enum State { None, Open, Proposed, Paid, Cancelled }

    struct Bounty {
        address requester;
        uint64 createdAt;
        uint64 deadline;
        State state;
        uint256 amount; // escrow still held for this bounty (total funded minus refunds; 0 once paid)
        uint256 bookId; // proposed or paid registry book, 0 if none
        address payee; // proposed or paid contributor
        uint64 executableAt; // end of the dispute window, 0 if no proposal
        string title;
        string author;
        string language;
        string notes;
        string verdictCid; // IPFS CID of the scan report holding the AI verdict
    }

    event BountyCreated(
        uint256 indexed id,
        address indexed requester,
        string title,
        string author,
        string language,
        string notes,
        uint64 deadline,
        uint256 amount
    );
    event BountyFunded(uint256 indexed id, address indexed funder, uint256 amount);
    event PayoutProposed(uint256 indexed id, uint256 indexed bookId, address payee, string verdictCid, uint64 executableAt);
    event PayoutCancelled(uint256 indexed id, address indexed by, string reason);
    event PayoutExecuted(uint256 indexed id, uint256 indexed bookId, address payee, uint256 toPayee, uint256 fee, bool feeSent);
    event BountyCancelled(uint256 indexed id, string reason);
    event Refunded(uint256 indexed id, address indexed funder, uint256 amount);
    event PayoutClaimed(address indexed payee, uint256 amount);
    event FeesSwept(address indexed to, uint256 amount);

    error BountyTooSmall();
    error BadText(); // a title, author, language, notes, reason or verdictCid length is out of range
    error BadDeadline();
    error UnknownBounty(uint256 id);
    error NotOpen(uint256 id);
    error NotProposed(uint256 id);
    error DeadlinePassed(uint256 id);
    error DisputeWindowActive(uint256 id, uint64 executableAt);
    error BadPayee();
    error BookNotApproved(uint256 bookId);
    error BookTooOld(uint256 bookId); // submitted before the bounty was created
    error BookAlreadyUsed(uint256 bookId);
    error NotAuthorized();
    error NothingToClaim();
    error NothingToRefund();
    error ZeroValue();
    error TransferFailed();
    error BadConfig();

    function RESOLVER_ROLE() external view returns (bytes32); // keccak256("RESOLVER_ROLE"), the host signer
    function BOUNTY_FEE_BPS() external view returns (uint16); // 500 (5 % into the fund)
    function MIN_BOUNTY() external view returns (uint256); // 0.02 ether, so the fee >= the fund's MIN_DONATION
    function DISPUTE_SECONDS() external view returns (uint256); // immutable, constructor
    function registry() external view returns (address); // the Alexandria book registry
    function feeFund() external view returns (address); // AlexandriaFund, or address(0): fees then wait in unsentFees

    /// title 1–200 bytes, author 1–120, language 2–16, notes <= 280; deadline 1 hour to 90 days ahead.
    function createBounty(
        string calldata title,
        string calldata author,
        string calldata language,
        string calldata notes,
        uint64 deadline
    ) external payable returns (uint256 id);
    /// Open or Proposed, before the deadline.
    function addFunds(uint256 id) external payable;
    /// RESOLVER_ROLE; Open, before the deadline; the book exists, was submitted after the bounty and answers no other bounty.
    function proposePayout(uint256 id, uint256 bookId, address payee, string calldata verdictCid) external;
    /// The registry's CURATOR_ROLE or this contract's DEFAULT_ADMIN_ROLE (Safe); Proposed -> Open.
    function cancelPayout(uint256 id, string calldata reason) external;
    /// Anyone; Proposed and the dispute window is over; the registry book is Approved.
    /// Credits 95 % to the payee (claimPayout) and sends 5 % to the fund; a failed fee transfer never blocks the payout.
    function executePayout(uint256 id) external;
    function claimPayout() external;
    /// DEFAULT_ADMIN_ROLE (Safe), e.g. for a copyrighted request; Open or Proposed -> Cancelled.
    function cancelBounty(uint256 id, string calldata reason) external;
    /// Cancelled, or Open once the deadline has passed.
    function claimRefund(uint256 id) external;
    /// DEFAULT_ADMIN_ROLE (Safe): fees that could not reach the fund.
    function sweepFees(address payable to) external;

    function getBounty(uint256 id) external view returns (Bounty memory);
    function bountyCount() external view returns (uint256);
    function contributionOf(uint256 id, address funder) external view returns (uint256);
    function claimable(address payee) external view returns (uint256);
    function bookUsed(uint256 bookId) external view returns (bool);
    function unsentFees() external view returns (uint256);
}
