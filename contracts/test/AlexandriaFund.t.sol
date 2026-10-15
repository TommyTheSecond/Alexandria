// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AlexandriaFund} from "../src/AlexandriaFund.sol";
import {IAlexandriaFund} from "../src/IAlexandriaFund.sol";

contract ReentrantReceiver {
    AlexandriaFund public fund;
    bool public reentrancyAttempted;
    bool public reentrancySucceeded;

    constructor(AlexandriaFund _fund) {
        fund = _fund;
    }

    receive() external payable {
        if (!reentrancyAttempted) {
            reentrancyAttempted = true;
            (bool success, ) = address(fund).call(abi.encodeWithSelector(fund.claim.selector));
            reentrancySucceeded = success;
        }
    }
}

contract AlexandriaFundTest is Test {
    AlexandriaFund public fund;
    address public admin = address(0xAD);
    address public attester = address(0xAA);
    address public op1 = address(0x01);
    address public op2 = address(0x02);
    address public op3 = address(0x03);
    address public donor = address(0xDA);

    uint256 public constant MIN_EPOCH = 600; // 10 minutes

    function setUp() public {
        vm.deal(donor, 100 ether);
        vm.deal(op1, 1 ether);
        vm.deal(op2, 1 ether);
        vm.deal(op3, 1 ether);

        fund = new AlexandriaFund(admin, attester, MIN_EPOCH);
    }

    function test_Constructor_RolesAndConstants() public view {
        assertTrue(fund.hasRole(fund.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(fund.hasRole(fund.ATTESTER_ROLE(), attester));
        assertEq(fund.OPERATOR_SHARE_BPS(), 5000);
        assertEq(fund.MIN_DONATION(), 0.001 ether);
        assertEq(fund.MAX_OPERATORS(), 100);
        assertEq(fund.MIN_EPOCH_SECONDS(), MIN_EPOCH);
        assertTrue(fund.donationsOpen());
    }

    function test_Donate_SplitMath() public {
        vm.prank(donor);
        fund.donate{value: 1 ether}("First donation");

        (
            uint256 totalDonated,
            uint256 operatorPool,
            uint256 storageBalance,
            uint256 epoch,
            ,
            ,
            uint256 operatorCount
        ) = fund.stats();

        assertEq(totalDonated, 1 ether);
        assertEq(operatorPool, 0.5 ether);
        assertEq(storageBalance, 0.5 ether);
        assertEq(epoch, 0);
        assertEq(operatorCount, 0);
    }

    function testFuzz_Donate_SplitMath(uint256 amount) public {
        amount = bound(amount, 0.001 ether, 1000 ether);
        vm.deal(donor, amount);

        vm.prank(donor);
        fund.donate{value: amount}("fuzz donation");

        (, uint256 operatorPool, uint256 storageBalance, , , , ) = fund.stats();

        uint256 expectedOperators = (amount * 5000) / 10000;
        uint256 expectedStorage = amount - expectedOperators;

        assertEq(operatorPool, expectedOperators);
        assertEq(storageBalance, expectedStorage);
        assertEq(operatorPool + storageBalance, amount);
    }

    function test_Donate_PlainTransfer() public {
        vm.prank(donor);
        (bool sent, ) = address(fund).call{value: 0.1 ether}("");
        assertTrue(sent);

        assertEq(fund.totalDonated(), 0.1 ether);
        assertEq(fund.operatorPool(), 0.05 ether);
        assertEq(fund.storageBalance(), 0.05 ether);
    }

    function test_Donate_RevertsOnTooSmall() public {
        vm.prank(donor);
        vm.expectRevert(IAlexandriaFund.DonationTooSmall.selector);
        fund.donate{value: 0.0009 ether}("too small");
    }

    function test_Donate_RevertsOnNoteTooLong() public {
        string memory longNote = new string(141);
        vm.prank(donor);
        vm.expectRevert(IAlexandriaFund.NoteTooLong.selector);
        fund.donate{value: 0.01 ether}(longNote);
    }

    function test_Donate_RevertsWhenClosed() public {
        vm.prank(admin);
        fund.setDonationsOpen(false);

        vm.prank(donor);
        vm.expectRevert(IAlexandriaFund.DonationsClosed.selector);
        fund.donate{value: 0.01 ether}("closed");
    }

    function test_RegisterOperator_SuccessAndUniqueGateway() public {
        vm.prank(op1);
        fund.registerOperator("https://node1.example.org");

        (address[] memory ops, string[] memory gws) = fund.operatorList();
        assertEq(ops.length, 1);
        assertEq(ops[0], op1);
        assertEq(gws[0], "https://node1.example.org");

        // Duplicate operator registration reverts
        vm.prank(op1);
        vm.expectRevert(IAlexandriaFund.AlreadyRegistered.selector);
        fund.registerOperator("https://node1-alt.example.org");

        // Taken gateway reverts
        vm.prank(op2);
        vm.expectRevert(IAlexandriaFund.GatewayTaken.selector);
        fund.registerOperator("https://node1.example.org");
    }

    function test_RegisterOperator_GatewayValidation() public {
        vm.startPrank(op1);

        // Too short (< 10)
        vm.expectRevert(IAlexandriaFund.BadGateway.selector);
        fund.registerOperator("http://a");

        // Missing http/https prefix
        vm.expectRevert(IAlexandriaFund.BadGateway.selector);
        fund.registerOperator("ftp://node1.example.org");

        // Valid onion URL
        fund.registerOperator("http://zm3fkcrtlaclnxw2u5xjjpauwp3ngchkhu3ji26xrvejf46mglvrkqad.onion");
        vm.stopPrank();
    }

    function test_UpdateGateway_And_Leave() public {
        vm.prank(op1);
        fund.registerOperator("https://node1.example.org");

        vm.prank(op1);
        fund.updateGateway("https://node1-new.example.org");

        (, string[] memory gws) = fund.operatorList();
        assertEq(gws[0], "https://node1-new.example.org");

        vm.prank(op1);
        fund.leave();

        (address[] memory opsAfter, ) = fund.operatorList();
        assertEq(opsAfter.length, 0);

        // Can register again after leaving
        vm.prank(op1);
        fund.registerOperator("https://node1-new.example.org");
    }

    function test_CloseEpoch_And_Claim() public {
        vm.prank(op1);
        fund.registerOperator("https://node1.example.org");
        vm.prank(op2);
        fund.registerOperator("https://node2.example.org");

        // Donate 1.001 AVAX -> pool gets 0.5005 AVAX
        vm.prank(donor);
        fund.donate{value: 1.001 ether}("Test donation");

        uint256 pool = fund.operatorPool();

        // Warp time past MIN_EPOCH
        vm.warp(block.timestamp + MIN_EPOCH);

        address[] memory active = new address[](2);
        active[0] = op1;
        active[1] = op2;

        vm.prank(attester);
        fund.closeEpoch(active, "bafybeireportcid123");

        assertEq(fund.epoch(), 1);
        uint256 expectedShare = pool / 2;
        assertEq(fund.owed(op1), expectedShare);
        assertEq(fund.owed(op2), expectedShare);

        // Dust remains in pool
        assertEq(fund.operatorPool(), pool - (expectedShare * 2));

        // Claim
        uint256 op1Before = op1.balance;
        vm.prank(op1);
        fund.claim();
        assertEq(op1.balance, op1Before + expectedShare);
        assertEq(fund.owed(op1), 0);

        // Cannot claim twice
        vm.prank(op1);
        vm.expectRevert(IAlexandriaFund.NothingToClaim.selector);
        fund.claim();
    }

    function test_CloseEpoch_EmptyActiveListRollsOver() public {
        vm.prank(donor);
        fund.donate{value: 1 ether}("Rollover test");

        uint256 initialPool = fund.operatorPool();

        vm.warp(block.timestamp + MIN_EPOCH);

        address[] memory active = new address[](0);

        vm.prank(attester);
        fund.closeEpoch(active, "bafybeireportempty");

        assertEq(fund.epoch(), 1);
        assertEq(fund.lastShare(), 0);
        // Pool is completely preserved
        assertEq(fund.operatorPool(), initialPool);
    }

    function test_CloseEpoch_RevertsOnTooSoon() public {
        address[] memory active = new address[](0);
        vm.prank(attester);
        vm.expectRevert(IAlexandriaFund.EpochTooSoon.selector);
        fund.closeEpoch(active, "cid");
    }

    function test_CloseEpoch_RevertsOnUnregisteredOrDuplicate() public {
        vm.prank(op1);
        fund.registerOperator("https://node1.example.org");

        vm.warp(block.timestamp + MIN_EPOCH);

        // Unregistered address in active
        address[] memory activeWithUnregistered = new address[](2);
        activeWithUnregistered[0] = op1;
        activeWithUnregistered[1] = op2; // op2 not registered

        vm.prank(attester);
        vm.expectRevert(IAlexandriaFund.BadActiveList.selector);
        fund.closeEpoch(activeWithUnregistered, "cid");

        // Duplicate address in active
        address[] memory activeWithDuplicate = new address[](2);
        activeWithDuplicate[0] = op1;
        activeWithDuplicate[1] = op1;

        vm.prank(attester);
        vm.expectRevert(IAlexandriaFund.BadActiveList.selector);
        fund.closeEpoch(activeWithDuplicate, "cid");
    }

    function test_WithdrawStorage_OnlyAdmin() public {
        vm.prank(donor);
        fund.donate{value: 2 ether}("Storage test");

        address payable recipient = payable(address(0xFA));

        // Non-admin reverts
        vm.prank(op1);
        vm.expectRevert();
        fund.withdrawStorage(recipient, 0.5 ether, "Storage bill");

        // Admin succeeds
        vm.prank(admin);
        fund.withdrawStorage(recipient, 0.5 ether, "Filebase storage pin");

        assertEq(recipient.balance, 0.5 ether);
        assertEq(fund.storageBalance(), 0.5 ether);
    }

    function test_Reentrancy_Claim() public {
        ReentrantReceiver reentrant = new ReentrantReceiver(fund);
        address reentrantAddr = address(reentrant);

        vm.prank(reentrantAddr);
        fund.registerOperator("https://reentrant.node.org");

        vm.prank(donor);
        fund.donate{value: 2 ether}("Reentrancy test");

        vm.warp(block.timestamp + MIN_EPOCH);

        address[] memory active = new address[](1);
        active[0] = reentrantAddr;

        vm.prank(attester);
        fund.closeEpoch(active, "cid");

        // Claim with reentrant receiver - ReentrancyGuard should protect against reentrant attempt
        vm.prank(reentrantAddr);
        fund.claim();

        assertTrue(reentrant.reentrancyAttempted());
        assertFalse(reentrant.reentrancySucceeded());
        assertEq(address(reentrant).balance, 1 ether);
        assertEq(fund.owed(reentrantAddr), 0);
    }

    function test_RemoveOperator_OnlyAdmin_And_MaintainsOwed() public {
        vm.prank(op1);
        fund.registerOperator("https://node1.example.org");

        vm.prank(donor);
        fund.donate{value: 2 ether}("Donation");

        vm.warp(block.timestamp + MIN_EPOCH);
        address[] memory active = new address[](1);
        active[0] = op1;
        vm.prank(attester);
        fund.closeEpoch(active, "cid1");

        assertEq(fund.owed(op1), 1 ether);

        // Non-admin cannot remove
        vm.prank(op2);
        vm.expectRevert();
        fund.removeOperator(op1, "malicious");

        // Admin removes operator
        vm.prank(admin);
        fund.removeOperator(op1, "bad behavior");

        // op1 still has owed and can claim it
        assertEq(fund.owed(op1), 1 ether);
        uint256 op1Before = op1.balance;
        vm.prank(op1);
        fund.claim();
        assertEq(op1.balance, op1Before + 1 ether);

        // op1 cannot be in active list anymore
        vm.warp(block.timestamp + MIN_EPOCH);
        vm.prank(attester);
        vm.expectRevert(IAlexandriaFund.BadActiveList.selector);
        fund.closeEpoch(active, "cid2");
    }

    function test_Leave_MaintainsOwed_And_RevertsIfInActive() public {
        vm.prank(op1);
        fund.registerOperator("https://node1.example.org");

        vm.prank(donor);
        fund.donate{value: 2 ether}("Donation");

        vm.warp(block.timestamp + MIN_EPOCH);
        address[] memory active = new address[](1);
        active[0] = op1;
        vm.prank(attester);
        fund.closeEpoch(active, "cid1");

        assertEq(fund.owed(op1), 1 ether);

        // op1 leaves
        vm.prank(op1);
        fund.leave();

        // op1 still has owed and can claim it
        assertEq(fund.owed(op1), 1 ether);
        uint256 op1Before = op1.balance;
        vm.prank(op1);
        fund.claim();
        assertEq(op1.balance, op1Before + 1 ether);

        // op1 cannot be in active list after leaving
        vm.warp(block.timestamp + MIN_EPOCH);
        vm.prank(attester);
        vm.expectRevert(IAlexandriaFund.BadActiveList.selector);
        fund.closeEpoch(active, "cid2");
    }

    function test_CloseEpoch_OnlyAttester() public {
        address[] memory active = new address[](0);
        vm.warp(block.timestamp + MIN_EPOCH);

        // op1 is not attester -> reverts
        vm.prank(op1);
        vm.expectRevert();
        fund.closeEpoch(active, "cid");
    }

    function test_MaxOperators_Limit() public {
        for (uint256 i = 1; i <= 100; i++) {
            address op = address(uint160(0x1000 + i));
            vm.prank(op);
            fund.registerOperator(string(abi.encodePacked("https://node", vm.toString(i), ".example.org")));
        }

        (address[] memory ops, ) = fund.operatorList();
        assertEq(ops.length, 100);

        // 101st operator reverts
        address op101 = address(0x9999);
        vm.prank(op101);
        vm.expectRevert(IAlexandriaFund.TooManyOperators.selector);
        fund.registerOperator("https://node101.example.org");
    }

    function test_SetDonationsOpen_OnlyAdmin_And_Reopen() public {
        vm.prank(op1);
        vm.expectRevert();
        fund.setDonationsOpen(false);

        vm.prank(admin);
        fund.setDonationsOpen(false);
        assertFalse(fund.donationsOpen());

        vm.prank(donor);
        vm.expectRevert(IAlexandriaFund.DonationsClosed.selector);
        fund.donate{value: 1 ether}("");

        vm.prank(admin);
        fund.setDonationsOpen(true);
        assertTrue(fund.donationsOpen());

        vm.prank(donor);
        fund.donate{value: 1 ether}("");
        assertEq(fund.totalDonated(), 1 ether);
    }

    function test_WithdrawStorage_RevertsOnInsufficientStorage() public {
        vm.prank(donor);
        fund.donate{value: 1 ether}(""); // 0.5 ether to storage

        vm.prank(admin);
        vm.expectRevert(IAlexandriaFund.InsufficientStorage.selector);
        fund.withdrawStorage(payable(admin), 0.6 ether, "excess");
    }
}
