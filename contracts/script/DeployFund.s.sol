// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {AlexandriaFund} from "../src/AlexandriaFund.sol";

contract DeployFund is Script {
    address public constant SAFE_ADMIN = 0x18189bC3d8A59f75924f47d845c9DdeA283629A1;
    uint256 public constant DEFAULT_MIN_EPOCH = 600;

    function run() external returns (AlexandriaFund fund) {
        require(block.chainid == 43113 || block.chainid == 31337, "Fuji or Anvil only");

        address admin = vm.envOr("ADMIN", SAFE_ADMIN);
        address attester = vm.envOr("ATTESTER", address(0));

        if (attester == address(0)) {
            // For local Anvil tests or when not specified, fall back to msg.sender or a deterministic address
            attester = msg.sender;
        }

        uint256 minEpoch = vm.envOr("MIN_EPOCH_SECONDS", DEFAULT_MIN_EPOCH);

        require(admin != address(0), "Admin required");
        require(attester != address(0), "Attester required");

        vm.startBroadcast();
        fund = new AlexandriaFund(admin, attester, minEpoch);
        vm.stopBroadcast();
    }
}
