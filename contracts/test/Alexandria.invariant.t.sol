// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Alexandria} from "../src/Alexandria.sol";
import {IAlexandria} from "../src/IAlexandria.sol";

contract RegistryHandler is Test {
    Alexandria public registry;
    uint256 public maxBookCount;
    mapping(uint256 => bool) public wasRejected;
    uint256 private sequence;
    string private constant CID = "bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    constructor(Alexandria target) {
        registry = target;
    }

    function actor(uint256 index) public pure returns (address) {
        return address(uint160(0x1000 + index % 8));
    }

    function submit(uint256 sender) external {
        bytes32 digest = sha256(abi.encode(++sequence));
        vm.prank(actor(sender));
        try registry.submitBook(CID, CID, digest) returns (uint256) {} catch {}
        if (registry.bookCount() > maxBookCount) maxBookCount = registry.bookCount();
    }

    function review(uint256 sender, uint256 idSeed, bool approve) external {
        uint256 count = registry.bookCount();
        if (count == 0) return;
        uint256 id = idSeed % count + 1;
        vm.prank(actor(sender));
        try registry.review(id, approve, "invariant review") {
            if (!approve) wasRejected[id] = true;
        } catch {}
    }

    function flag(uint256 sender, uint256 idSeed) external {
        uint256 count = registry.bookCount();
        if (count == 0) return;
        vm.prank(actor(sender));
        try registry.flag(idSeed % count + 1, "invariant flag") {} catch {}
    }

    function setSubmissionsOpen(uint256 sender, bool open) external {
        vm.prank(actor(sender));
        try registry.setSubmissionsOpen(open) {} catch {}
    }
}

contract AlexandriaInvariantTest is StdInvariant, Test {
    Alexandria private registry;
    RegistryHandler private handler;

    function setUp() public {
        address[] memory curators = new address[](1);
        curators[0] = address(0x1001);
        registry = new Alexandria(address(0x1000), curators, address(0x1002));
        handler = new RegistryHandler(registry);
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = handler.submit.selector;
        selectors[1] = handler.review.selector;
        selectors[2] = handler.flag.selector;
        selectors[3] = handler.setSubmissionsOpen.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_BookCountNeverDecreases() public view {
        assertGe(registry.bookCount(), handler.maxBookCount());
    }

    function invariant_PendingCountsMatchBooks() public view {
        uint256 pending;
        for (uint256 id = 1; id <= registry.bookCount(); ++id) {
            if (registry.getBook(id).status == IAlexandria.Status.Pending) ++pending;
        }
        uint256 sum;
        for (uint256 i; i < 8; ++i) {
            sum += registry.pendingCount(handler.actor(i));
        }
        assertEq(sum, pending);
    }

    function invariant_RejectedIsFinal() public view {
        for (uint256 id = 1; id <= registry.bookCount(); ++id) {
            if (handler.wasRejected(id)) {
                assertEq(uint8(registry.getBook(id).status), uint8(IAlexandria.Status.Rejected));
            }
        }
    }

    function invariant_EveryIdHasAState() public view {
        for (uint256 id = 1; id <= registry.bookCount(); ++id) {
            assertTrue(registry.getBook(id).status != IAlexandria.Status.None);
        }
    }

    function invariant_HashIndexMatchesEveryBook() public view {
        for (uint256 id = 1; id <= registry.bookCount(); ++id) {
            assertEq(registry.idBySha256(registry.getBook(id).pdfSha256), id);
        }
    }

    function invariant_ConfirmedBookNeverFlagged() public view {
        for (uint256 id = 1; id <= registry.bookCount(); ++id) {
            IAlexandria.Book memory book = registry.getBook(id);
            if (book.confirmed) assertTrue(book.status != IAlexandria.Status.Flagged);
        }
    }
}
