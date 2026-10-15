// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IAlexandriaFund {
    event Donated(address indexed donor, uint256 amount, uint256 toOperators, uint256 toStorage, string note);
    event OperatorRegistered(address indexed operator, string gateway);
    event OperatorUpdated(address indexed operator, string gateway);
    event OperatorLeft(address indexed operator);
    event OperatorRemoved(address indexed operator, string reason);
    event EpochClosed(uint256 indexed epoch, uint256 activeCount, uint256 sharePerOperator, string reportCid);
    event Claimed(address indexed operator, uint256 amount);
    event StorageSpent(address indexed to, uint256 amount, string memo);
    event DonationsOpenChanged(bool open);

    error DonationsClosed();
    error DonationTooSmall();
    error NoteTooLong(); // note > 140 bytes
    error BadGateway();
    error GatewayTaken();
    error AlreadyRegistered();
    error NotRegistered();
    error TooManyOperators();
    error EpochTooSoon();
    error BadActiveList();
    error NothingToClaim();
    error InsufficientStorage();
    error TransferFailed();

    function ATTESTER_ROLE() external view returns (bytes32); // keccak256("ATTESTER_ROLE"), the host signer
    function OPERATOR_SHARE_BPS() external view returns (uint16); // 5000
    function MIN_DONATION() external view returns (uint256); // 0.001 ether
    function MAX_OPERATORS() external view returns (uint256); // 100
    function MIN_EPOCH_SECONDS() external view returns (uint256); // immutable, constructor

    function donate(string calldata note) external payable; // receive() == donate("")
    function registerOperator(string calldata gateway) external; // payout = msg.sender; gateway 10–200 bytes, "https://" or "http://"; exact URL unique
    function updateGateway(string calldata gateway) external;
    function leave() external; // owed stays claimable
    function removeOperator(address op, string calldata reason) external; // DEFAULT_ADMIN_ROLE (Safe)
    function closeEpoch(address[] calldata active, string calldata reportCid) external; // ATTESTER_ROLE; >= MIN_EPOCH_SECONDS since last;
    // every address registered, no duplicates;
    // pool / active.length to each; dust stays; empty list = roll over
    function claim() external; // nonReentrant, pull
    function withdrawStorage(address payable to, uint256 amount, string calldata memo) external; // DEFAULT_ADMIN_ROLE
    function setDonationsOpen(bool open) external; // DEFAULT_ADMIN_ROLE

    function stats()
        external
        view
        returns (
            uint256 totalDonated,
            uint256 operatorPool,
            uint256 storageBalance,
            uint256 epoch,
            uint256 lastEpochAt,
            uint256 lastShare,
            uint256 operatorCount
        );
    function operatorList() external view returns (address[] memory operators, string[] memory gateways);
    function owed(address operator) external view returns (uint256);
}
