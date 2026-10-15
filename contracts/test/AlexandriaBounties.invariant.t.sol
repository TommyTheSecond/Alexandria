// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Alexandria} from "../src/Alexandria.sol";
import {AlexandriaFund} from "../src/AlexandriaFund.sol";
import {AlexandriaBounties} from "../src/AlexandriaBounties.sol";
import {IAlexandriaBounties} from "../src/IAlexandriaBounties.sol";

contract BountyHandler is Test {
    AlexandriaBounties public bounties;
    Alexandria public registry;
    address public safe;
    address public curator;
    address public relayer;
    address public resolver;
    string internal constant CID = "bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    uint256 public totalIn;
    uint256 public totalOut; // claims + refunds + swept fees + fees sent to the fund
    uint256 internal sequence;

    constructor(AlexandriaBounties b, Alexandria r, address safe_, address curator_, address relayer_, address resolver_) {
        bounties = b;
        registry = r;
        safe = safe_;
        curator = curator_;
        relayer = relayer_;
        resolver = resolver_;
    }

    function actor(uint256 i) public pure returns (address) {
        return address(uint160(0x3000 + (i % 6)));
    }

    function bountyId(uint256 seed) internal view returns (uint256) {
        uint256 count = bounties.bountyCount();
        return count == 0 ? 0 : 1 + (seed % count);
    }

    function create(uint256 who, uint256 amount, uint256 days_) external {
        amount = bound(amount, 0.02 ether, 50 ether);
        days_ = bound(days_, 1, 60);
        address sender = actor(who);
        vm.deal(sender, amount);
        vm.prank(sender);
        try bounties.createBounty{value: amount}("T", "A", "en", "", uint64(block.timestamp + days_ * 1 days)) {
            totalIn += amount;
        } catch {}
    }

    function addFunds(uint256 who, uint256 seed, uint256 amount) external {
        uint256 id = bountyId(seed);
        if (id == 0) return;
        amount = bound(amount, 1, 10 ether);
        address sender = actor(who);
        vm.deal(sender, amount);
        vm.prank(sender);
        try bounties.addFunds{value: amount}(id) {
            totalIn += amount;
        } catch {}
    }

    function propose(uint256 seed, uint256 payeeSeed, bool approveBook) external {
        uint256 id = bountyId(seed);
        if (id == 0) return;
        vm.prank(relayer);
        uint256 bookId = registry.submitBook(CID, CID, sha256(abi.encode(++sequence)));
        if (approveBook) {
            vm.prank(curator);
            registry.review(bookId, true, "ok");
        }
        vm.prank(resolver);
        try bounties.proposePayout(id, bookId, actor(payeeSeed), CID) {} catch {}
    }

    function cancelPayout(uint256 seed) external {
        uint256 id = bountyId(seed);
        if (id == 0) return;
        vm.prank(curator);
        try bounties.cancelPayout(id, "") {} catch {}
    }

    function execute(uint256 seed) external {
        uint256 id = bountyId(seed);
        if (id == 0) return;
        uint256 fundBefore = address(bounties.feeFund()).balance;
        try bounties.executePayout(id) {
            totalOut += address(bounties.feeFund()).balance - fundBefore;
        } catch {}
    }

    function claimPayout(uint256 who) external {
        address sender = actor(who);
        uint256 amount = bounties.claimable(sender);
        vm.prank(sender);
        try bounties.claimPayout() {
            totalOut += amount;
        } catch {}
    }

    function cancelBounty(uint256 seed) external {
        uint256 id = bountyId(seed);
        if (id == 0) return;
        vm.prank(safe);
        try bounties.cancelBounty(id, "") {} catch {}
    }

    function refund(uint256 who, uint256 seed) external {
        uint256 id = bountyId(seed);
        if (id == 0) return;
        address sender = actor(who);
        uint256 amount = bounties.contributionOf(id, sender);
        vm.prank(sender);
        try bounties.claimRefund(id) {
            totalOut += amount;
        } catch {}
    }

    function sweep() external {
        uint256 amount = bounties.unsentFees();
        vm.prank(safe);
        try bounties.sweepFees(payable(address(0x5707))) {
            totalOut += amount;
        } catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 20 days));
    }
}

contract AlexandriaBountiesInvariantTest is StdInvariant, Test {
    AlexandriaBounties internal bounties;
    BountyHandler internal handler;

    function setUp() public {
        vm.warp(1_760_000_000);
        address safe = address(0x5AFE);
        address curator = address(0xC01);
        address relayer = address(0xB01);
        address resolver = address(0x7E50);
        address[] memory curators = new address[](1);
        curators[0] = curator;
        Alexandria registry = new Alexandria(safe, curators, relayer);
        AlexandriaFund fund = new AlexandriaFund(safe, address(0xA77E), 600);
        bounties = new AlexandriaBounties(safe, resolver, address(registry), address(fund), 600);
        handler = new BountyHandler(bounties, registry, safe, curator, relayer, resolver);
        targetContract(address(handler));
    }

    /// The contract holds exactly what it still owes: open escrow, unclaimed payouts and unsent fees.
    function invariant_BalanceCoversObligations() public view {
        assertEq(address(bounties).balance, bounties.totalEscrow() + bounties.totalClaimable() + bounties.unsentFees());
    }

    /// totalEscrow is the sum of every bounty's remaining amount.
    function invariant_EscrowMatchesBounties() public view {
        uint256 sum;
        for (uint256 id = 1; id <= bounties.bountyCount(); ++id) {
            IAlexandriaBounties.Bounty memory b = bounties.getBounty(id);
            sum += b.amount;
            if (b.state == IAlexandriaBounties.State.Paid) assertEq(b.amount, 0);
        }
        assertEq(sum, bounties.totalEscrow());
    }

    /// Nothing is created or lost: everything paid in is either still held or was paid out.
    function invariant_Conservation() public view {
        assertEq(handler.totalIn(), address(bounties).balance + handler.totalOut());
    }
}
