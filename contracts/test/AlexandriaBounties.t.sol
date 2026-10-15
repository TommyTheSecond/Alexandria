// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Alexandria} from "../src/Alexandria.sol";
import {IAlexandria} from "../src/IAlexandria.sol";
import {AlexandriaFund} from "../src/AlexandriaFund.sol";
import {AlexandriaBounties} from "../src/AlexandriaBounties.sol";
import {IAlexandriaBounties} from "../src/IAlexandriaBounties.sol";

contract RevertingFund {
    function donate(string calldata) external payable {
        revert("closed");
    }
}

contract ReentrantPayee {
    AlexandriaBounties internal bounties;
    uint256 public calls;

    constructor(AlexandriaBounties b) {
        bounties = b;
    }

    function claim() external {
        bounties.claimPayout();
    }

    receive() external payable {
        ++calls;
        if (calls == 1) {
            // A second claim inside the transfer must fail; the outer claim still succeeds once.
            try bounties.claimPayout() {} catch {}
        }
    }
}

contract AlexandriaBountiesTest is Test {
    Alexandria internal registry;
    AlexandriaFund internal fund;
    AlexandriaBounties internal bounties;

    address internal safe = address(0x5AFE);
    address internal curator = address(0xC01);
    address internal relayer = address(0xB01);
    address internal resolver = address(0x7E50);
    address internal requester = address(0xAE01);
    address internal funder = address(0xF0D1);
    address internal uploader = address(0x0B10);
    address internal stranger = address(0xBAD);
    string internal constant CID = "bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    string internal constant VERDICT = "bafkreibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    uint256 internal constant DISPUTE = 600;
    uint256 internal sequence;

    event PayoutExecuted(uint256 indexed id, uint256 indexed bookId, address payee, uint256 toPayee, uint256 fee, bool feeSent);

    function setUp() public {
        vm.warp(1_760_000_000);
        address[] memory curators = new address[](1);
        curators[0] = curator;
        registry = new Alexandria(safe, curators, relayer);
        fund = new AlexandriaFund(safe, address(0xA77E), 600);
        bounties = new AlexandriaBounties(safe, resolver, address(registry), address(fund), DISPUTE);
        vm.deal(requester, 100 ether);
        vm.deal(funder, 100 ether);
        vm.deal(stranger, 100 ether);
    }

    // ---------- helpers ----------

    function create(uint256 amount) internal returns (uint256 id) {
        vm.prank(requester);
        id = bounties.createBounty{value: amount}("Candide", "Voltaire", "en", "Smollett translation", uint64(block.timestamp + 7 days));
    }

    function submitBook() internal returns (uint256 bookId) {
        vm.prank(relayer);
        bookId = registry.submitBook(CID, CID, sha256(abi.encode(++sequence)));
    }

    function approve(uint256 bookId) internal {
        vm.prank(curator);
        registry.review(bookId, true, "verified");
    }

    function propose(uint256 id, uint256 bookId) internal {
        vm.prank(resolver);
        bounties.proposePayout(id, bookId, uploader, VERDICT);
    }

    function readyToExecute(uint256 amount) internal returns (uint256 id, uint256 bookId) {
        id = create(amount);
        bookId = submitBook();
        approve(bookId);
        propose(id, bookId);
        vm.warp(block.timestamp + DISPUTE);
    }

    function state(uint256 id) internal view returns (IAlexandriaBounties.State) {
        return bounties.getBounty(id).state;
    }

    // ---------- constructor ----------

    function test_Constructor_RolesAndConstants() public view {
        assertTrue(bounties.hasRole(bounties.DEFAULT_ADMIN_ROLE(), safe));
        assertTrue(bounties.hasRole(bounties.RESOLVER_ROLE(), resolver));
        assertEq(bounties.BOUNTY_FEE_BPS(), 500);
        assertEq(bounties.MIN_BOUNTY(), 0.02 ether);
        assertEq(bounties.DISPUTE_SECONDS(), DISPUTE);
        assertEq(bounties.registry(), address(registry));
        assertEq(bounties.feeFund(), address(fund));
        // The fee is never below the fund's minimum donation.
        assertGe(bounties.MIN_BOUNTY() * bounties.BOUNTY_FEE_BPS() / 10000, fund.MIN_DONATION());
    }

    function test_Constructor_RejectsBadConfig() public {
        vm.expectRevert(IAlexandriaBounties.BadConfig.selector);
        new AlexandriaBounties(address(0), resolver, address(registry), address(fund), DISPUTE);
        vm.expectRevert(IAlexandriaBounties.BadConfig.selector);
        new AlexandriaBounties(safe, address(0), address(registry), address(fund), DISPUTE);
        vm.expectRevert(IAlexandriaBounties.BadConfig.selector);
        new AlexandriaBounties(safe, resolver, address(0x1234), address(fund), DISPUTE);
        vm.expectRevert(IAlexandriaBounties.BadConfig.selector);
        new AlexandriaBounties(safe, resolver, address(registry), address(fund), 7 days + 1);
    }

    function test_Constructor_AllowsNoFund() public {
        AlexandriaBounties b = new AlexandriaBounties(safe, resolver, address(registry), address(0), DISPUTE);
        assertEq(b.feeFund(), address(0));
    }

    // ---------- createBounty / addFunds ----------

    function test_CreateBounty_StoresEverything() public {
        uint256 id = create(1 ether);
        IAlexandriaBounties.Bounty memory b = bounties.getBounty(id);
        assertEq(id, 1);
        assertEq(bounties.bountyCount(), 1);
        assertEq(b.requester, requester);
        assertEq(b.title, "Candide");
        assertEq(b.author, "Voltaire");
        assertEq(b.language, "en");
        assertEq(b.notes, "Smollett translation");
        assertEq(b.amount, 1 ether);
        assertEq(uint8(b.state), uint8(IAlexandriaBounties.State.Open));
        assertEq(b.createdAt, block.timestamp);
        assertEq(bounties.contributionOf(id, requester), 1 ether);
        assertEq(bounties.totalEscrow(), 1 ether);
        assertEq(address(bounties).balance, 1 ether);
    }

    function test_CreateBounty_RejectsSmallAmount() public {
        vm.expectRevert(IAlexandriaBounties.BountyTooSmall.selector);
        vm.prank(requester);
        bounties.createBounty{value: 0.02 ether - 1}("T", "A", "en", "", uint64(block.timestamp + 1 days));
    }

    function test_CreateBounty_RejectsBadText() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        string memory long201 = string(new bytes(201));
        vm.startPrank(requester);
        vm.expectRevert(IAlexandriaBounties.BadText.selector);
        bounties.createBounty{value: 1 ether}("", "A", "en", "", deadline);
        vm.expectRevert(IAlexandriaBounties.BadText.selector);
        bounties.createBounty{value: 1 ether}(long201, "A", "en", "", deadline);
        vm.expectRevert(IAlexandriaBounties.BadText.selector);
        bounties.createBounty{value: 1 ether}("T", "", "en", "", deadline);
        vm.expectRevert(IAlexandriaBounties.BadText.selector);
        bounties.createBounty{value: 1 ether}("T", "A", "e", "", deadline);
        vm.expectRevert(IAlexandriaBounties.BadText.selector);
        bounties.createBounty{value: 1 ether}("T", "A", "en", string(new bytes(281)), deadline);
        vm.stopPrank();
    }

    function test_CreateBounty_RejectsBadDeadline() public {
        vm.startPrank(requester);
        vm.expectRevert(IAlexandriaBounties.BadDeadline.selector);
        bounties.createBounty{value: 1 ether}("T", "A", "en", "", uint64(block.timestamp + 1 hours - 1));
        vm.expectRevert(IAlexandriaBounties.BadDeadline.selector);
        bounties.createBounty{value: 1 ether}("T", "A", "en", "", uint64(block.timestamp + 90 days + 1));
        vm.stopPrank();
    }

    function test_AddFunds_AddsToEscrowAndContribution() public {
        uint256 id = create(1 ether);
        vm.prank(funder);
        bounties.addFunds{value: 0.5 ether}(id);
        assertEq(bounties.getBounty(id).amount, 1.5 ether);
        assertEq(bounties.contributionOf(id, funder), 0.5 ether);
        assertEq(bounties.totalEscrow(), 1.5 ether);
    }

    function test_AddFunds_WorksWhileProposed() public {
        uint256 id = create(1 ether);
        propose(id, submitBook());
        vm.prank(funder);
        bounties.addFunds{value: 1 ether}(id);
        assertEq(bounties.getBounty(id).amount, 2 ether);
    }

    function test_AddFunds_Rejects() public {
        uint256 id = create(1 ether);
        vm.expectRevert(IAlexandriaBounties.ZeroValue.selector);
        vm.prank(funder);
        bounties.addFunds(id);

        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.UnknownBounty.selector, 2));
        vm.prank(funder);
        bounties.addFunds{value: 1 ether}(2);

        vm.warp(block.timestamp + 7 days);
        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.DeadlinePassed.selector, id));
        vm.prank(funder);
        bounties.addFunds{value: 1 ether}(id);
    }

    function test_AddFunds_RejectsCancelled() public {
        uint256 id = create(1 ether);
        vm.prank(safe);
        bounties.cancelBounty(id, "copyrighted");
        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.NotOpen.selector, id));
        vm.prank(funder);
        bounties.addFunds{value: 1 ether}(id);
    }

    // ---------- proposePayout ----------

    function test_Propose_StartsDisputeWindow() public {
        uint256 id = create(1 ether);
        uint256 bookId = submitBook();
        propose(id, bookId);
        IAlexandriaBounties.Bounty memory b = bounties.getBounty(id);
        assertEq(uint8(b.state), uint8(IAlexandriaBounties.State.Proposed));
        assertEq(b.bookId, bookId);
        assertEq(b.payee, uploader);
        assertEq(b.verdictCid, VERDICT);
        assertEq(b.executableAt, block.timestamp + DISPUTE);
    }

    function test_Propose_OnlyResolver() public {
        uint256 id = create(1 ether);
        uint256 bookId = submitBook();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, bounties.RESOLVER_ROLE()
            )
        );
        vm.prank(stranger);
        bounties.proposePayout(id, bookId, uploader, VERDICT);
    }

    function test_Propose_Rejects() public {
        uint256 id = create(1 ether);
        uint256 bookId = submitBook();
        vm.startPrank(resolver);
        vm.expectRevert(IAlexandriaBounties.BadPayee.selector);
        bounties.proposePayout(id, bookId, address(0), VERDICT);
        vm.expectRevert(IAlexandriaBounties.BadText.selector);
        bounties.proposePayout(id, bookId, uploader, "");
        vm.expectRevert(abi.encodeWithSelector(IAlexandria.UnknownBook.selector, 99));
        bounties.proposePayout(id, 99, uploader, VERDICT);
        bounties.proposePayout(id, bookId, uploader, VERDICT);
        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.NotOpen.selector, id));
        bounties.proposePayout(id, bookId, uploader, VERDICT);
        vm.stopPrank();
    }

    function test_Propose_RejectsBookOlderThanBounty() public {
        uint256 oldBook = submitBook();
        vm.warp(block.timestamp + 1);
        uint256 id = create(1 ether);
        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.BookTooOld.selector, oldBook));
        propose(id, oldBook);
    }

    function test_Propose_RejectsAfterDeadline() public {
        uint256 id = create(1 ether);
        uint256 bookId = submitBook();
        vm.warp(block.timestamp + 7 days);
        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.DeadlinePassed.selector, id));
        propose(id, bookId);
    }

    function test_Propose_RejectsBookUsedByAnotherBounty() public {
        (uint256 first, uint256 bookId) = readyToExecute(1 ether);
        bounties.executePayout(first);
        uint256 second = create(1 ether);
        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.BookAlreadyUsed.selector, bookId));
        propose(second, bookId);
    }

    // ---------- cancelPayout ----------

    function test_CancelPayout_ByCuratorReopens() public {
        uint256 id = create(1 ether);
        uint256 bookId = submitBook();
        propose(id, bookId);
        vm.prank(curator);
        bounties.cancelPayout(id, "wrong edition");
        IAlexandriaBounties.Bounty memory b = bounties.getBounty(id);
        assertEq(uint8(b.state), uint8(IAlexandriaBounties.State.Open));
        assertEq(b.bookId, 0);
        assertEq(b.payee, address(0));
        assertEq(b.executableAt, 0);
        assertEq(b.verdictCid, "");
        propose(id, submitBook()); // can be proposed again
        assertEq(uint8(state(id)), uint8(IAlexandriaBounties.State.Proposed));
    }

    function test_CancelPayout_BySafe() public {
        uint256 id = create(1 ether);
        propose(id, submitBook());
        vm.prank(safe);
        bounties.cancelPayout(id, "dispute");
        assertEq(uint8(state(id)), uint8(IAlexandriaBounties.State.Open));
    }

    function test_CancelPayout_Rejects() public {
        uint256 id = create(1 ether);
        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.NotProposed.selector, id));
        vm.prank(curator);
        bounties.cancelPayout(id, "nothing proposed");
        propose(id, submitBook());
        vm.expectRevert(IAlexandriaBounties.NotAuthorized.selector);
        vm.prank(stranger);
        bounties.cancelPayout(id, "griefing");
        vm.expectRevert(IAlexandriaBounties.NotAuthorized.selector);
        vm.prank(resolver);
        bounties.cancelPayout(id, "resolver is not a curator");
    }

    // ---------- executePayout ----------

    function test_Execute_PaysPayeeAndFund() public {
        (uint256 id, uint256 bookId) = readyToExecute(2 ether);
        vm.expectEmit(true, true, false, true, address(bounties));
        emit PayoutExecuted(id, bookId, uploader, 1.9 ether, 0.1 ether, true);
        vm.prank(stranger); // anyone can execute
        bounties.executePayout(id);

        assertEq(uint8(state(id)), uint8(IAlexandriaBounties.State.Paid));
        assertEq(bounties.getBounty(id).amount, 0);
        assertEq(bounties.claimable(uploader), 1.9 ether);
        assertTrue(bounties.bookUsed(bookId));
        assertEq(fund.totalDonated(), 0.1 ether);
        assertEq(fund.operatorPool(), 0.05 ether);
        assertEq(fund.storageBalance(), 0.05 ether);
        assertEq(bounties.unsentFees(), 0);
        assertEq(bounties.totalEscrow(), 0);
        assertEq(address(bounties).balance, 1.9 ether);
    }

    function test_Execute_WaitsForDisputeWindow() public {
        uint256 id = create(1 ether);
        uint256 bookId = submitBook();
        approve(bookId);
        propose(id, bookId);
        uint64 executableAt = bounties.getBounty(id).executableAt;
        vm.warp(executableAt - 1);
        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.DisputeWindowActive.selector, id, executableAt));
        bounties.executePayout(id);
        vm.warp(executableAt);
        bounties.executePayout(id);
    }

    function test_Execute_NeedsApprovedBook() public {
        uint256 id = create(1 ether);
        uint256 bookId = submitBook();
        propose(id, bookId);
        vm.warp(block.timestamp + DISPUTE);
        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.BookNotApproved.selector, bookId));
        bounties.executePayout(id); // still Pending

        vm.prank(curator);
        registry.review(bookId, false, "not public domain");
        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.BookNotApproved.selector, bookId));
        bounties.executePayout(id); // Rejected
    }

    function test_Execute_FlaggedBookWaits() public {
        (uint256 id, uint256 bookId) = readyToExecute(1 ether);
        for (uint160 i = 1; i <= 3; ++i) {
            vm.prank(address(i));
            registry.flag(bookId, "check");
        }
        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.BookNotApproved.selector, bookId));
        bounties.executePayout(id);
    }

    function test_Execute_OnlyOnce() public {
        (uint256 id,) = readyToExecute(1 ether);
        bounties.executePayout(id);
        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.NotProposed.selector, id));
        bounties.executePayout(id);
    }

    function test_Execute_FeeWaitsWhenFundReverts() public {
        RevertingFund broken = new RevertingFund();
        bounties = new AlexandriaBounties(safe, resolver, address(registry), address(broken), DISPUTE);
        (uint256 id,) = readyToExecute(1 ether);
        bounties.executePayout(id);
        assertEq(bounties.claimable(uploader), 0.95 ether);
        assertEq(bounties.unsentFees(), 0.05 ether);
    }

    function test_Execute_FeeWaitsWhenDonationsClosed() public {
        vm.prank(safe);
        fund.setDonationsOpen(false);
        (uint256 id,) = readyToExecute(1 ether);
        bounties.executePayout(id);
        assertEq(bounties.claimable(uploader), 0.95 ether);
        assertEq(bounties.unsentFees(), 0.05 ether);
        assertEq(fund.totalDonated(), 0);
    }

    function test_Execute_FeeWaitsWithoutFund() public {
        bounties = new AlexandriaBounties(safe, resolver, address(registry), address(0), DISPUTE);
        (uint256 id,) = readyToExecute(1 ether);
        bounties.executePayout(id);
        assertEq(bounties.unsentFees(), 0.05 ether);
    }

    function test_Execute_FeeWaitsWhenFundHasNoCode() public {
        bounties = new AlexandriaBounties(safe, resolver, address(registry), address(0xF00D), DISPUTE);
        (uint256 id,) = readyToExecute(1 ether);
        bounties.executePayout(id);
        assertEq(bounties.unsentFees(), 0.05 ether);
        assertEq(address(0xF00D).balance, 0);
    }

    function testFuzz_Execute_SplitAddsUp(uint256 amount) public {
        amount = bound(amount, 0.02 ether, 1_000 ether);
        vm.deal(requester, amount);
        (uint256 id,) = readyToExecute(amount);
        bounties.executePayout(id);
        uint256 fee = amount * 500 / 10000;
        assertEq(bounties.claimable(uploader) + fund.totalDonated(), amount);
        assertEq(fund.totalDonated(), fee);
        assertGe(fee, fund.MIN_DONATION());
    }

    // ---------- claimPayout ----------

    function test_ClaimPayout_Pays() public {
        (uint256 id,) = readyToExecute(1 ether);
        bounties.executePayout(id);
        vm.prank(uploader);
        bounties.claimPayout();
        assertEq(uploader.balance, 0.95 ether);
        assertEq(bounties.claimable(uploader), 0);
        vm.expectRevert(IAlexandriaBounties.NothingToClaim.selector);
        vm.prank(uploader);
        bounties.claimPayout();
    }

    function test_ClaimPayout_ResistsReentrancy() public {
        ReentrantPayee payee = new ReentrantPayee(bounties);
        uint256 id = create(1 ether);
        uint256 bookId = submitBook();
        approve(bookId);
        vm.prank(resolver);
        bounties.proposePayout(id, bookId, address(payee), VERDICT);
        vm.warp(block.timestamp + DISPUTE);
        bounties.executePayout(id);
        payee.claim();
        assertEq(address(payee).balance, 0.95 ether);
        assertEq(payee.calls(), 1);
        assertEq(bounties.claimable(address(payee)), 0);
    }

    // ---------- cancelBounty / claimRefund ----------

    function test_CancelBounty_RefundsEveryFunder() public {
        uint256 id = create(1 ether);
        vm.prank(funder);
        bounties.addFunds{value: 0.5 ether}(id);
        vm.prank(safe);
        bounties.cancelBounty(id, "copyrighted request");
        assertEq(uint8(state(id)), uint8(IAlexandriaBounties.State.Cancelled));

        uint256 before = requester.balance;
        vm.prank(requester);
        bounties.claimRefund(id);
        assertEq(requester.balance, before + 1 ether);
        vm.prank(funder);
        bounties.claimRefund(id);
        assertEq(bounties.getBounty(id).amount, 0);
        assertEq(bounties.totalEscrow(), 0);
        assertEq(address(bounties).balance, 0);

        vm.expectRevert(IAlexandriaBounties.NothingToRefund.selector);
        vm.prank(funder);
        bounties.claimRefund(id);
    }

    function test_CancelBounty_OnlySafeAndOnlyOpen() public {
        uint256 id = create(1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, curator, bounties.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(curator);
        bounties.cancelBounty(id, "no");

        (uint256 paid,) = readyToExecute(1 ether);
        bounties.executePayout(paid);
        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.NotOpen.selector, paid));
        vm.prank(safe);
        bounties.cancelBounty(paid, "too late");
    }

    function test_Refund_OnlyAfterDeadlineWhileOpen() public {
        uint256 id = create(1 ether);
        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.NotOpen.selector, id));
        vm.prank(requester);
        bounties.claimRefund(id);
        vm.warp(block.timestamp + 7 days);
        vm.prank(requester);
        bounties.claimRefund(id);
        assertEq(bounties.contributionOf(id, requester), 0);
    }

    function test_Refund_ProposedPastDeadlineNeedsCancel() public {
        uint256 id = create(1 ether);
        propose(id, submitBook()); // the book never gets approved
        vm.warp(block.timestamp + 7 days);
        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.NotOpen.selector, id));
        vm.prank(requester);
        bounties.claimRefund(id);
        vm.prank(curator);
        bounties.cancelPayout(id, "never approved");
        vm.prank(requester);
        bounties.claimRefund(id);
        assertEq(bounties.totalEscrow(), 0);
    }

    function test_Refund_NotAfterPayout() public {
        (uint256 id,) = readyToExecute(1 ether);
        bounties.executePayout(id);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.NotOpen.selector, id));
        vm.prank(requester);
        bounties.claimRefund(id);
    }

    // ---------- sweepFees ----------

    function test_SweepFees() public {
        bounties = new AlexandriaBounties(safe, resolver, address(registry), address(0), DISPUTE);
        (uint256 id,) = readyToExecute(1 ether);
        bounties.executePayout(id);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, bounties.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(stranger);
        bounties.sweepFees(payable(stranger));

        vm.prank(safe);
        bounties.sweepFees(payable(address(0x5707)));
        assertEq(address(0x5707).balance, 0.05 ether);
        assertEq(bounties.unsentFees(), 0);

        vm.expectRevert(IAlexandriaBounties.NothingToClaim.selector);
        vm.prank(safe);
        bounties.sweepFees(payable(address(0x5707)));
    }

    function test_UnknownBounty() public {
        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.UnknownBounty.selector, 0));
        bounties.getBounty(0);
        vm.expectRevert(abi.encodeWithSelector(IAlexandriaBounties.UnknownBounty.selector, 1));
        bounties.getBounty(1);
    }
}
