// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAlexandriaFund} from "./IAlexandriaFund.sol";

/// @notice Public-domain library fund contract: splits donations 50/50 between node operators and storage.
contract AlexandriaFund is IAlexandriaFund, AccessControl, ReentrancyGuard {
    bytes32 public constant override ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
    uint16 public constant override OPERATOR_SHARE_BPS = 5000; // 50%
    uint256 public constant override MIN_DONATION = 0.001 ether;
    uint256 public constant override MAX_OPERATORS = 100;
    uint256 public immutable override MIN_EPOCH_SECONDS;

    bool public donationsOpen;
    uint256 public totalDonated;
    uint256 public operatorPool;
    uint256 public storageBalance;
    uint256 public epoch;
    uint256 public lastEpochAt;
    uint256 public lastShare;
    uint256 public totalOwed;

    struct OperatorInfo {
        string gateway;
        uint256 index;
        bool registered;
    }

    mapping(address => OperatorInfo) private operators;
    address[] private operatorAddresses;
    mapping(bytes32 => bool) private gatewayTaken;
    mapping(address => uint256) public override owed;

    constructor(address admin, address attester, uint256 minEpochSeconds) {
        if (admin == address(0) || attester == address(0)) revert TransferFailed();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ATTESTER_ROLE, attester);
        MIN_EPOCH_SECONDS = minEpochSeconds;
        donationsOpen = true;
        lastEpochAt = block.timestamp;
    }

    receive() external payable {
        _donate("");
    }

    function donate(string calldata note) external payable override {
        _donate(note);
    }

    function _donate(string memory note) internal {
        if (!donationsOpen) revert DonationsClosed();
        if (msg.value < MIN_DONATION) revert DonationTooSmall();
        if (bytes(note).length > 140) revert NoteTooLong();

        uint256 toOperators = (msg.value * OPERATOR_SHARE_BPS) / 10000;
        uint256 toStorage = msg.value - toOperators;

        operatorPool += toOperators;
        storageBalance += toStorage;
        totalDonated += msg.value;

        emit Donated(msg.sender, msg.value, toOperators, toStorage, note);
    }

    function registerOperator(string calldata gateway) external override {
        _validateGateway(gateway);
        if (operators[msg.sender].registered) revert AlreadyRegistered();
        if (operatorAddresses.length >= MAX_OPERATORS) revert TooManyOperators();

        bytes32 gwHash = keccak256(bytes(gateway));
        if (gatewayTaken[gwHash]) revert GatewayTaken();

        gatewayTaken[gwHash] = true;
        operators[msg.sender] = OperatorInfo({
            gateway: gateway,
            index: operatorAddresses.length,
            registered: true
        });
        operatorAddresses.push(msg.sender);

        emit OperatorRegistered(msg.sender, gateway);
    }

    function updateGateway(string calldata gateway) external override {
        _validateGateway(gateway);
        if (!operators[msg.sender].registered) revert NotRegistered();

        bytes32 oldHash = keccak256(bytes(operators[msg.sender].gateway));
        bytes32 newHash = keccak256(bytes(gateway));

        if (oldHash != newHash) {
            if (gatewayTaken[newHash]) revert GatewayTaken();
            gatewayTaken[oldHash] = false;
            gatewayTaken[newHash] = true;
            operators[msg.sender].gateway = gateway;
        }

        emit OperatorUpdated(msg.sender, gateway);
    }

    function leave() external override {
        if (!operators[msg.sender].registered) revert NotRegistered();
        _removeOperator(msg.sender);
        emit OperatorLeft(msg.sender);
    }

    function removeOperator(address op, string calldata reason) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!operators[op].registered) revert NotRegistered();
        _removeOperator(op);
        emit OperatorRemoved(op, reason);
    }

    function _removeOperator(address op) internal {
        bytes32 gwHash = keccak256(bytes(operators[op].gateway));
        gatewayTaken[gwHash] = false;

        uint256 idx = operators[op].index;
        uint256 lastIdx = operatorAddresses.length - 1;

        if (idx != lastIdx) {
            address lastOp = operatorAddresses[lastIdx];
            operatorAddresses[idx] = lastOp;
            operators[lastOp].index = idx;
        }

        operatorAddresses.pop();
        delete operators[op];
    }

    function _validateGateway(string calldata gateway) internal pure {
        bytes memory b = bytes(gateway);
        if (b.length < 10 || b.length > 200) revert BadGateway();

        // Must start with http:// or https://
        bool isHttp = b.length >= 7 &&
            b[0] == 'h' && b[1] == 't' && b[2] == 't' && b[3] == 'p' && b[4] == ':' && b[5] == '/' && b[6] == '/';
        bool isHttps = b.length >= 8 &&
            b[0] == 'h' && b[1] == 't' && b[2] == 't' && b[3] == 'p' && b[4] == 's' && b[5] == ':' && b[6] == '/' && b[7] == '/';

        if (!isHttp && !isHttps) revert BadGateway();
    }

    function closeEpoch(address[] calldata active, string calldata reportCid)
        external
        override
        onlyRole(ATTESTER_ROLE)
    {
        if (block.timestamp < lastEpochAt + MIN_EPOCH_SECONDS) revert EpochTooSoon();

        // Validate active list: all must be currently registered, with no duplicates
        for (uint256 i = 0; i < active.length; i++) {
            address op = active[i];
            if (!operators[op].registered) revert BadActiveList();
            for (uint256 j = i + 1; j < active.length; j++) {
                if (op == active[j]) revert BadActiveList();
            }
        }

        if (active.length > 0) {
            uint256 share = operatorPool / active.length;
            uint256 totalDistributed = share * active.length;
            operatorPool -= totalDistributed;

            for (uint256 i = 0; i < active.length; i++) {
                owed[active[i]] += share;
            }
            totalOwed += totalDistributed;
            lastShare = share;
        } else {
            // Empty active list: pool rolls over to next epoch unchanged
            lastShare = 0;
        }

        epoch += 1;
        lastEpochAt = block.timestamp;

        emit EpochClosed(epoch, active.length, lastShare, reportCid);
    }

    function claim() external override nonReentrant {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert NothingToClaim();

        owed[msg.sender] = 0;
        totalOwed -= amount;

        emit Claimed(msg.sender, amount);

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function withdrawStorage(address payable to, uint256 amount, string calldata memo)
        external
        override
        nonReentrant
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (to == address(0)) revert TransferFailed();
        if (amount > storageBalance) revert InsufficientStorage();

        storageBalance -= amount;

        emit StorageSpent(to, amount, memo);

        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function setDonationsOpen(bool open) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        donationsOpen = open;
        emit DonationsOpenChanged(open);
    }

    function stats()
        external
        view
        override
        returns (
            uint256 _totalDonated,
            uint256 _operatorPool,
            uint256 _storageBalance,
            uint256 _epoch,
            uint256 _lastEpochAt,
            uint256 _lastShare,
            uint256 _operatorCount
        )
    {
        return (
            totalDonated,
            operatorPool,
            storageBalance,
            epoch,
            lastEpochAt,
            lastShare,
            operatorAddresses.length
        );
    }

    function operatorList()
        external
        view
        override
        returns (address[] memory _operators, string[] memory _gateways)
    {
        uint256 len = operatorAddresses.length;
        _operators = new address[](len);
        _gateways = new string[](len);

        for (uint256 i = 0; i < len; i++) {
            _operators[i] = operatorAddresses[i];
            _gateways[i] = operators[operatorAddresses[i]].gateway;
        }
    }
}
