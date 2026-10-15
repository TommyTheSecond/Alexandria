// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IAlexandria} from "../src/IAlexandria.sol";
import {Alexandria} from "../src/Alexandria.sol";

contract AlexandriaTest is Test {
    Alexandria internal registry;
    address internal admin = address(0xA11);
    address internal curator = address(0xC01);
    address internal relayer = address(0xB01);
    address internal reader = address(0xD01);
    string internal constant CID = "bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    uint256 internal sequence;

    event BookSubmitted(
        uint256 indexed id, address indexed submitter, string pdfCid, string metaCid, bytes32 pdfSha256
    );
    event BookReviewed(uint256 indexed id, address indexed curator, IAlexandria.Status status, string reason);

    function setUp() public {
        address[] memory curators = new address[](1);
        curators[0] = curator;
        registry = new Alexandria(admin, curators, relayer);
    }

    function submit(address sender) internal returns (uint256) {
        bytes32 digest = sha256(abi.encode(++sequence));
        vm.prank(sender);
        return registry.submitBook(CID, CID, digest);
    }

    function approve(uint256 id) internal {
        vm.prank(curator);
        registry.review(id, true, "verified");
    }

    function flagThree(uint256 id) internal {
        for (uint160 i = 1; i <= 3; ++i) {
            vm.prank(address(i));
            registry.flag(id, "check");
        }
    }

    function expectUnauthorized(address sender, bytes32 role) internal {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, sender, role));
        vm.prank(sender);
    }

    function test_Constructor_RolesAndConstants() public view {
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(registry.hasRole(registry.CURATOR_ROLE(), curator));
        assertTrue(registry.hasRole(registry.RELAYER_ROLE(), relayer));
        assertFalse(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), address(this)));
        assertTrue(registry.submissionsOpen());
        assertEq(registry.FLAG_THRESHOLD(), 3);
        assertEq(registry.MAX_PENDING_PER_SUBMITTER(), 5);
    }

    function test_Submit_AssignsIdsFromOne() public {
        vm.warp(12345);
        assertEq(submit(reader), 1);
        assertEq(submit(reader), 2);
        IAlexandria.Book memory book = registry.getBook(1);
        assertEq(book.pdfCid, CID);
        assertEq(book.metaCid, CID);
        assertEq(book.pdfSha256, sha256(abi.encode(uint256(1))));
        assertEq(book.submitter, reader);
        assertEq(book.submittedAt, 12345);
        assertEq(uint8(book.status), uint8(IAlexandria.Status.Pending));
        assertEq(book.flags, 0);
        assertFalse(book.confirmed);
        assertEq(registry.bookCount(), 2);
        assertEq(registry.idBySha256(book.pdfSha256), 1);
        assertEq(registry.idBySha256(bytes32(uint256(99))), 0);
    }

    function test_Submit_EmitsBookSubmitted() public {
        bytes32 digest = sha256(abi.encode(uint256(1)));
        vm.expectEmit(true, true, false, true, address(registry));
        emit BookSubmitted(1, reader, CID, CID, digest);
        submit(reader);
    }

    function test_Submit_RevertsWhenClosed() public {
        uint256 id = submit(reader);
        vm.prank(admin);
        registry.setSubmissionsOpen(false);
        vm.expectRevert(IAlexandria.SubmissionsClosed.selector);
        registry.submitBook(CID, CID, bytes32(uint256(2)));
        assertEq(registry.getBook(id).submitter, reader);
        approve(id);
        vm.prank(admin);
        registry.setSubmissionsOpen(true);
        assertEq(submit(reader), 2);
    }

    function test_Submit_RevertsOnEmptyCid() public {
        vm.expectRevert(IAlexandria.InvalidCid.selector);
        registry.submitBook("", CID, bytes32(uint256(1)));
        vm.expectRevert(IAlexandria.InvalidCid.selector);
        registry.submitBook(CID, "", bytes32(uint256(1)));
    }

    function test_Submit_RevertsOnCidOver100Bytes() public {
        string memory tooLong = new string(101);
        vm.expectRevert(IAlexandria.InvalidCid.selector);
        registry.submitBook(tooLong, CID, bytes32(uint256(1)));
        vm.expectRevert(IAlexandria.InvalidCid.selector);
        registry.submitBook(CID, tooLong, bytes32(uint256(1)));
    }

    function test_Submit_RevertsOnZeroHash() public {
        vm.expectRevert(IAlexandria.InvalidHash.selector);
        registry.submitBook(CID, CID, bytes32(0));
    }

    function test_Submit_RevertsOnDuplicate_ReturnsExistingId() public {
        uint256 id = submit(reader);
        bytes32 digest = registry.getBook(id).pdfSha256;
        vm.expectRevert(abi.encodeWithSelector(IAlexandria.Duplicate.selector, id));
        registry.submitBook(CID, CID, digest);
    }

    function test_Submit_NonRelayerLimitedToFivePending() public {
        for (uint256 i; i < 5; ++i) {
            submit(reader);
        }
        vm.expectRevert(abi.encodeWithSelector(IAlexandria.TooManyPending.selector, reader));
        vm.prank(reader);
        registry.submitBook(CID, CID, bytes32(uint256(900)));
        approve(1);
        assertEq(submit(reader), 6);
    }

    function test_Submit_RelayerExemptFromPendingLimit() public {
        for (uint256 i; i < 8; ++i) {
            submit(relayer);
        }
        assertEq(registry.pendingCount(relayer), 8);
    }

    function test_Review_OnlyCurator() public {
        uint256 id = submit(reader);
        expectUnauthorized(reader, registry.CURATOR_ROLE());
        registry.review(id, true, "no");
    }

    function test_Review_ApprovePending() public {
        uint256 id = submit(reader);
        vm.expectEmit(true, true, false, true, address(registry));
        emit BookReviewed(id, curator, IAlexandria.Status.Approved, "verified");
        approve(id);
        assertEq(uint8(registry.getBook(id).status), uint8(IAlexandria.Status.Approved));
        assertFalse(registry.getBook(id).confirmed);
    }

    function test_Review_RejectPending() public {
        uint256 id = submit(reader);
        vm.prank(curator);
        registry.review(id, false, "not eligible");
        assertEq(uint8(registry.getBook(id).status), uint8(IAlexandria.Status.Rejected));
    }

    function test_Review_DecrementsPendingCount() public {
        uint256 first = submit(reader);
        uint256 second = submit(reader);
        approve(first);
        assertEq(registry.pendingCount(reader), 1);
        vm.prank(curator);
        registry.review(second, false, "reject");
        assertEq(registry.pendingCount(reader), 0);
    }

    function test_Review_RevertsOnApproved() public {
        uint256 id = submit(reader);
        approve(id);
        vm.expectRevert(abi.encodeWithSelector(IAlexandria.NotReviewable.selector, id, IAlexandria.Status.Approved));
        approve(id);
    }

    function test_Review_RevertsOnRejected() public {
        uint256 id = submit(reader);
        vm.prank(curator);
        registry.review(id, false, "reject");
        vm.expectRevert(abi.encodeWithSelector(IAlexandria.NotReviewable.selector, id, IAlexandria.Status.Rejected));
        approve(id);
    }

    function test_Flag_OncePerAddress() public {
        uint256 id = submit(reader);
        approve(id);
        vm.prank(reader);
        registry.flag(id, "check");
        vm.expectRevert(abi.encodeWithSelector(IAlexandria.AlreadyFlagged.selector, id, reader));
        vm.prank(reader);
        registry.flag(id, "again");
        assertEq(registry.getBook(id).flags, 1);
    }

    function test_Flag_RevertsOnPending() public {
        uint256 id = submit(reader);
        vm.expectRevert(abi.encodeWithSelector(IAlexandria.NotFlaggable.selector, id, IAlexandria.Status.Pending));
        registry.flag(id, "check");
    }

    function test_Flag_RevertsOnRejected() public {
        uint256 id = submit(reader);
        vm.prank(curator);
        registry.review(id, false, "reject");
        vm.expectRevert(abi.encodeWithSelector(IAlexandria.NotFlaggable.selector, id, IAlexandria.Status.Rejected));
        registry.flag(id, "check");
    }

    function test_Flag_ThreeFlagsMakeFlagged() public {
        uint256 id = submit(reader);
        approve(id);
        flagThree(id);
        assertEq(uint8(registry.getBook(id).status), uint8(IAlexandria.Status.Flagged));
        assertEq(registry.getBook(id).flags, 3);
        assertEq(registry.getBook(id).pdfCid, CID);
    }

    function test_ReviewFlagged_ApproveSetsConfirmed() public {
        uint256 id = submit(reader);
        approve(id);
        flagThree(id);
        approve(id);
        assertTrue(registry.getBook(id).confirmed);
        assertEq(registry.pendingCount(reader), 0);
    }

    function test_ReviewFlagged_Reject() public {
        uint256 id = submit(reader);
        approve(id);
        flagThree(id);
        vm.prank(curator);
        registry.review(id, false, "reject");
        assertEq(uint8(registry.getBook(id).status), uint8(IAlexandria.Status.Rejected));
        assertEq(registry.pendingCount(reader), 0);
    }

    function test_Flag_ConfirmedBookStaysApproved() public {
        uint256 id = submit(reader);
        approve(id);
        flagThree(id);
        approve(id);
        for (uint160 i = 4; i < 14; ++i) {
            vm.prank(address(i));
            registry.flag(id, "check again");
        }
        assertEq(registry.getBook(id).flags, 13);
        assertEq(uint8(registry.getBook(id).status), uint8(IAlexandria.Status.Approved));
    }

    function test_PublishSnapshot_OnlyCurator() public {
        expectUnauthorized(reader, registry.CURATOR_ROLE());
        registry.publishSnapshot(CID, 10);
    }

    function test_PublishSnapshot_StoresLatest() public {
        vm.prank(curator);
        registry.publishSnapshot(CID, 10);
        (string memory cid, uint256 atBlock) = registry.latestSnapshot();
        assertEq(cid, CID);
        assertEq(atBlock, 10);
    }

    function test_PublishSnapshot_RejectsInvalidCid() public {
        vm.expectRevert(IAlexandria.InvalidCid.selector);
        vm.prank(curator);
        registry.publishSnapshot("", 10);
    }

    function test_SetSubmissionsOpen_OnlyAdmin() public {
        expectUnauthorized(curator, registry.DEFAULT_ADMIN_ROLE());
        registry.setSubmissionsOpen(false);
    }

    function test_GetBook_RevertsOnZeroAndPastEnd() public {
        vm.expectRevert(abi.encodeWithSelector(IAlexandria.UnknownBook.selector, 0));
        registry.getBook(0);
        vm.expectRevert(abi.encodeWithSelector(IAlexandria.UnknownBook.selector, 1));
        registry.getBook(1);
    }

    function testFuzz_Submit_CidByteLimits(bytes memory cid, bytes32 digest) public {
        vm.assume(digest != bytes32(0));
        if (cid.length == 0 || cid.length > 100) {
            vm.expectRevert(IAlexandria.InvalidCid.selector);
            registry.submitBook(string(cid), CID, digest);
        } else {
            assertEq(registry.submitBook(string(cid), CID, digest), 1);
        }
    }
}
