// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {Alexandria} from "../src/Alexandria.sol";

/// @notice Uses only explicitly supplied unlocked Anvil addresses, never embedded private keys.
contract SeedAnvil is Script {
    function run() external returns (Alexandria registry) {
        require(block.chainid == 31337, "Anvil only");
        address sender = vm.envAddress("ANVIL_SENDER");
        address[] memory flaggers = vm.envAddress("ANVIL_FLAGGERS", ",");
        require(flaggers.length == 3, "Supply three distinct unlocked flaggers");
        require(
            flaggers[0] != flaggers[1] && flaggers[0] != flaggers[2] && flaggers[1] != flaggers[2],
            "Flaggers must be distinct"
        );
        string memory path = vm.envOr("FIXTURE_CATALOG", string("../fixtures/catalog.json"));
        string memory catalog = vm.readFile(path);
        address[] memory curators = new address[](1);
        curators[0] = sender;
        vm.startBroadcast(sender);
        registry = new Alexandria(sender, curators, sender);
        for (uint256 i; i < 3; ++i) {
            string memory prefix = string.concat(".books[", vm.toString(i), "]");
            uint256 id = registry.submitBook(
                vm.parseJsonString(catalog, string.concat(prefix, ".pdfCid")),
                vm.parseJsonString(catalog, string.concat(prefix, ".metaCid")),
                vm.parseJsonBytes32(catalog, string.concat(prefix, ".pdfSha256"))
            );
            registry.review(id, true, "Local fixture approved");
        }
        vm.stopBroadcast();
        for (uint256 i; i < flaggers.length; ++i) {
            vm.startBroadcast(flaggers[i]);
            registry.flag(3, "Local flag fixture");
            vm.stopBroadcast();
        }
    }
}
