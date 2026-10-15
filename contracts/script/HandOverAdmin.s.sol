// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {Alexandria} from "../src/Alexandria.sol";
import {ISafeOwners} from "./Deploy.s.sol";

/// @notice Fallback only. Prefer deploying with the Safe as admin from the start.
contract HandOverAdmin is Script {
    function checked() private view returns (Alexandria registry, address safe) {
        require(block.chainid == 43113 || block.chainid == 31337, "Fuji or Anvil only");
        registry = Alexandria(vm.envAddress("CONTRACT"));
        safe = vm.envAddress("ADMIN");
        require(safe.code.length > 0 && registry != Alexandria(safe), "Expected distinct registry and Safe");
        address[] memory owners = ISafeOwners(safe).getOwners();
        address[] memory curators = vm.envAddress("CURATORS", ",");
        require(owners.length == 1 && curators.length > 0 && owners[0] == curators[0], "Safe must be owned by P1");
        require(ISafeOwners(safe).getThreshold() == 1, "Safe threshold must be one");
    }

    function grant() external {
        (Alexandria registry, address safe) = checked();
        vm.startBroadcast();
        registry.grantRole(registry.DEFAULT_ADMIN_ROLE(), safe);
        vm.stopBroadcast();
    }

    function renounce() external {
        (Alexandria registry, address safe) = checked();
        require(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), safe), "Safe has no admin role");
        require(vm.envBool("SAFE_TEST_CONFIRMED"), "First confirm an admin call executed through the Safe");
        require(vm.envBool("RENOUNCE_CONFIRMED"), "P1 must explicitly confirm renouncing");
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        require(deployer != safe, "Cannot renounce the Safe role");
        vm.startBroadcast(deployer);
        registry.renounceRole(registry.DEFAULT_ADMIN_ROLE(), deployer);
        vm.stopBroadcast();
    }
}
