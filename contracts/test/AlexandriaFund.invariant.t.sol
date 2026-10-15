// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {AlexandriaFund} from "../src/AlexandriaFund.sol";
import {IAlexandriaFund} from "../src/IAlexandriaFund.sol";

contract FundHandler is Test {
    AlexandriaFund public fund;
    address public admin;
    address public attester;

    uint256 public totalClaimed;
    uint256 public totalStorageSpent;

    address[] public operators;
    mapping(address => bool) public isOperator;

    constructor(AlexandriaFund _fund, address _admin, address _attester) {
        fund = _fund;
        admin = _admin;
        attester = _attester;
    }

    function actor(uint256 index) public pure returns (address) {
        return address(uint160(0x2000 + (index % 10)));
    }

    function donate(uint256 senderIdx, uint256 amount) external {
        amount = bound(amount, 0.001 ether, 10 ether);
        address sender = actor(senderIdx);
        vm.deal(sender, amount);
        vm.prank(sender);
        try fund.donate{value: amount}("fuzz donate") {} catch {}
    }

    function plainTransfer(uint256 senderIdx, uint256 amount) external {
        amount = bound(amount, 0.001 ether, 10 ether);
        address sender = actor(senderIdx);
        vm.deal(sender, amount);
        vm.prank(sender);
        (bool sent, ) = address(fund).call{value: amount}("");
        sent; // silence unused warning
    }

    function registerOperator(uint256 senderIdx) external {
        address sender = actor(senderIdx);
        if (!isOperator[sender]) {
            string memory gw = string(abi.encodePacked("https://node-", vm.toString(senderIdx % 10), ".org"));
            vm.prank(sender);
            try fund.registerOperator(gw) {
                isOperator[sender] = true;
                operators.push(sender);
            } catch {}
        }
    }

    function leave(uint256 senderIdx) external {
        address sender = actor(senderIdx);
        if (isOperator[sender]) {
            vm.prank(sender);
            try fund.leave() {
                isOperator[sender] = false;
                _removeOperatorFromList(sender);
            } catch {}
        }
    }

    function closeEpoch(uint256 seed) external {
        if (block.timestamp < fund.lastEpochAt() + fund.MIN_EPOCH_SECONDS()) {
            vm.warp(fund.lastEpochAt() + fund.MIN_EPOCH_SECONDS() + 1);
        }

        // Build active list from currently registered operators
        (address[] memory registered, ) = fund.operatorList();
        uint256 count = registered.length;
        address[] memory active;

        if (count == 0 || seed % 3 == 0) {
            // empty active list
            active = new address[](0);
        } else {
            uint256 pickCount = (seed % count) + 1;
            active = new address[](pickCount);
            for (uint256 i = 0; i < pickCount; i++) {
                active[i] = registered[i];
            }
        }

        vm.prank(attester);
        try fund.closeEpoch(active, "bafyreport") {} catch {}
    }

    function claim(uint256 senderIdx) external {
        address sender = actor(senderIdx);
        uint256 owedAmount = fund.owed(sender);
        if (owedAmount > 0) {
            vm.prank(sender);
            try fund.claim() {
                totalClaimed += owedAmount;
            } catch {}
        }
    }

    function withdrawStorage(uint256 amount) external {
        uint256 storageBal = fund.storageBalance();
        if (storageBal == 0) return;
        amount = bound(amount, 1, storageBal);

        address payable recipient = payable(address(0xFA));
        vm.prank(admin);
        try fund.withdrawStorage(recipient, amount, "spend") {
            totalStorageSpent += amount;
        } catch {}
    }

    function _removeOperatorFromList(address op) internal {
        for (uint256 i = 0; i < operators.length; i++) {
            if (operators[i] == op) {
                operators[i] = operators[operators.length - 1];
                operators.pop();
                break;
            }
        }
    }
}

contract AlexandriaFundInvariantTest is StdInvariant, Test {
    AlexandriaFund public fund;
    FundHandler public handler;

    address public admin = address(0xAD);
    address public attester = address(0xAA);
    uint256 public constant MIN_EPOCH = 600;

    function setUp() public {
        fund = new AlexandriaFund(admin, attester, MIN_EPOCH);
        handler = new FundHandler(fund, admin, attester);

        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = handler.donate.selector;
        selectors[1] = handler.plainTransfer.selector;
        selectors[2] = handler.registerOperator.selector;
        selectors[3] = handler.leave.selector;
        selectors[4] = handler.closeEpoch.selector;
        selectors[5] = handler.claim.selector;
        selectors[6] = handler.withdrawStorage.selector;

        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_SolvencyBalanceRule() public view {
        // Section 3.2: address(this).balance >= operatorPool + storageBalance + totalOwed
        assertGe(
            address(fund).balance,
            fund.operatorPool() + fund.storageBalance() + fund.totalOwed(),
            "Contract balance must cover operatorPool, storageBalance and totalOwed"
        );
    }

    function invariant_ConservationOfDonatedFunds() public view {
        assertEq(
            fund.totalDonated(),
            fund.operatorPool() + fund.storageBalance() + fund.totalOwed() + handler.totalClaimed() + handler.totalStorageSpent(),
            "Total donated must equal current balances + claimed + spent"
        );
    }
}
