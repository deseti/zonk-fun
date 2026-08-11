// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {LiquidityManager} from "../src/liquidity/LiquidityManager.sol";

/// @notice Configures the reviewed Phase 10 adapter after separate approval.
contract ConfigureDexAdapterBaseSepolia is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;

    function run() external {
        require(block.chainid == BASE_SEPOLIA_CHAIN_ID, "Base Sepolia chain required");

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        LiquidityManager liquidityManager = LiquidityManager(payable(vm.envAddress("LIQUIDITY_MANAGER_ADDRESS")));
        address dexAdapter = vm.envAddress("DEX_ADAPTER_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);
        liquidityManager.configureDexAdapter(dexAdapter);
        vm.stopBroadcast();
    }
}
