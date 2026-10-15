// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {Alexandria} from "../src/Alexandria.sol";

/// @notice Run after a confirmed broadcast, so I7 uses the actual receipt's hash and block.
contract RecordDeployment is Script {
    function run() external {
        require(block.chainid == 43113 || block.chainid == 31337, "Fuji or Anvil only");
        VmSafe.BroadcastTxSummary memory deployment =
            vm.getBroadcast("Alexandria", uint64(block.chainid), VmSafe.BroadcastTxType.Create);
        require(deployment.success && deployment.txHash != bytes32(0), "No successful deployment broadcast");
        require(deployment.contractAddress.code.length > 0, "Deployment is absent from this RPC");
        Alexandria registry = Alexandria(deployment.contractAddress);
        address admin = vm.envAddress("ADMIN");
        address[] memory curators = vm.envAddress("CURATORS", ",");
        address relayer = vm.envAddress("RELAYER");
        require(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin), "Admin does not match deployed state");
        require(registry.hasRole(registry.RELAYER_ROLE(), relayer), "Relayer does not match deployed state");
        for (uint256 i; i < curators.length; ++i) {
            require(registry.hasRole(registry.CURATOR_ROLE(), curators[i]), "Curator does not match deployed state");
        }
        string memory network = block.chainid == 43113 ? "fuji" : "anvil";
        string memory path = string.concat(vm.projectRoot(), "/../deployments/", network, ".json");
        if (block.chainid == 43113 && vm.exists(path)) {
            require(
                vm.parseJsonAddress(vm.readFile(path), ".address") == deployment.contractAddress,
                "Refusing to overwrite a different Fuji deployment"
            );
        }
        string memory key = "deployment";
        vm.serializeString(key, "network", network);
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "address", deployment.contractAddress);
        vm.serializeUint(key, "deployBlock", deployment.blockNumber);
        vm.serializeBytes32(key, "deployTx", deployment.txHash);
        vm.serializeAddress(key, "admin", admin);
        vm.serializeAddress(key, "curators", curators);
        vm.serializeAddress(key, "relayer", relayer);
        vm.serializeString(key, "abi", "abi/IAlexandria.json");
        string memory explorer = block.chainid == 43113
            ? string.concat("https://testnet.snowtrace.io/address/", vm.toString(deployment.contractAddress))
            : "";
        string memory json = vm.serializeString(key, "explorer", explorer);
        vm.writeJson(json, path);
    }
}
