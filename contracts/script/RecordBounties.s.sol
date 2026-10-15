// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {AlexandriaBounties} from "../src/AlexandriaBounties.sol";

/// @notice Run after a confirmed DeployBounties broadcast: writes deployments/<network>-bounties.json from the receipt.
contract RecordBounties is Script {
    function run() external {
        require(block.chainid == 43113 || block.chainid == 31337, "Fuji or Anvil only");
        VmSafe.BroadcastTxSummary memory deployment =
            vm.getBroadcast("AlexandriaBounties", uint64(block.chainid), VmSafe.BroadcastTxType.Create);
        require(deployment.success && deployment.txHash != bytes32(0), "No successful deployment broadcast");
        require(deployment.contractAddress.code.length > 0, "Deployment is absent from this RPC");
        AlexandriaBounties bounties = AlexandriaBounties(deployment.contractAddress);

        string memory network = block.chainid == 43113 ? "fuji" : "anvil";
        string memory key = "bounties";
        vm.serializeString(key, "network", network);
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "address", deployment.contractAddress);
        vm.serializeUint(key, "deployBlock", deployment.blockNumber);
        vm.serializeBytes32(key, "deployTx", deployment.txHash);
        vm.serializeAddress(key, "registry", bounties.registry());
        vm.serializeAddress(key, "fund", bounties.feeFund());
        vm.serializeUint(key, "disputeSeconds", bounties.DISPUTE_SECONDS());
        vm.serializeString(key, "abi", "abi/IAlexandriaBounties.json");
        string memory explorer = block.chainid == 43113
            ? string.concat("https://testnet.snowtrace.io/address/", vm.toString(deployment.contractAddress))
            : "";
        string memory json = vm.serializeString(key, "explorer", explorer);
        vm.writeJson(json, string.concat(vm.projectRoot(), "/../deployments/", network, "-bounties.json"));
    }
}
