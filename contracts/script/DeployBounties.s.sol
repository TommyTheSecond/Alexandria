// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {AlexandriaBounties} from "../src/AlexandriaBounties.sol";

/// @notice Deploys the bounty contract (I9). Fuji: RESOLVER = the host signer; FUND is optional (fees wait for the Safe).
/// REGISTRY defaults to the address in deployments/<network>.json, so a registry redeploy is picked up automatically.
///   RESOLVER=0x… [FUND=0x…] forge script script/DeployBounties.s.sol --rpc-url "$RPC_URL" --account "$DEPLOYER" --broadcast
///   then: forge script script/RecordBounties.s.sol --rpc-url "$RPC_URL"
contract DeployBounties is Script {
    address public constant SAFE_ADMIN = 0x18189bC3d8A59f75924f47d845c9DdeA283629A1;
    uint256 public constant DEFAULT_DISPUTE_SECONDS = 600;

    function run() external returns (AlexandriaBounties bounties) {
        require(block.chainid == 43113 || block.chainid == 31337, "Fuji or Anvil only");
        address admin = vm.envOr("ADMIN", SAFE_ADMIN);
        address resolver = vm.envAddress("RESOLVER");
        address registry = vm.envOr("REGISTRY", recordedRegistry());
        address fund = vm.envOr("FUND", address(0));
        uint256 dispute = vm.envOr("DISPUTE_SECONDS", DEFAULT_DISPUTE_SECONDS);
        require(registry.code.length > 0, "No registry at REGISTRY");
        require(fund == address(0) || fund.code.length > 0, "FUND has no code");

        vm.startBroadcast();
        bounties = new AlexandriaBounties(admin, resolver, registry, fund, dispute);
        vm.stopBroadcast();
    }

    /// The registry from the I7 deployment record (deployments/fuji.json or anvil.json).
    function recordedRegistry() internal view returns (address) {
        string memory network = block.chainid == 43113 ? "fuji" : "anvil";
        string memory path = string.concat(vm.projectRoot(), "/../deployments/", network, ".json");
        if (!vm.exists(path)) return address(0);
        return vm.parseJsonAddress(vm.readFile(path), ".address");
    }
}
