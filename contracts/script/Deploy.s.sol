// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {Alexandria} from "../src/Alexandria.sol";

interface ISafeOwners {
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
}

contract Deploy is Script {
    function run() external returns (Alexandria registry) {
        require(block.chainid == 43113 || block.chainid == 31337, "Fuji or Anvil only");
        address admin = vm.envAddress("ADMIN");
        address[] memory curators = vm.envAddress("CURATORS", ",");
        address relayer = vm.envAddress("RELAYER");
        require(admin != address(0) && relayer != address(0), "Admin and relayer are required");
        require(curators.length > 0, "At least one curator is required");
        for (uint256 i; i < curators.length; ++i) {
            require(curators[i] != address(0), "Invalid curator");
        }
        if (block.chainid == 43113) {
            require(admin.code.length > 0, "Fuji admin must be the deployed Safe");
            address[] memory owners = ISafeOwners(admin).getOwners();
            require(owners.length == 1 && owners[0] == curators[0], "Safe must be owned by P1");
            require(ISafeOwners(admin).getThreshold() == 1, "Safe threshold must be one");
        }
        vm.startBroadcast();
        registry = new Alexandria(admin, curators, relayer);
        vm.stopBroadcast();
    }
}
