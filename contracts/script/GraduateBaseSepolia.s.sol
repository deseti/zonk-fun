// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ILiquidityManager} from "../src/interfaces/ILiquidityManager.sol";
import {IZonkCurve} from "../src/interfaces/IZonkCurve.sol";

/// @notice Graduates an eligible curve through its immutable reviewed adapter.
contract GraduateBaseSepolia is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;

    function run() external returns (ILiquidityManager.GraduationRecord memory record) {
        require(block.chainid == BASE_SEPOLIA_CHAIN_ID, "Base Sepolia chain required");

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        IZonkCurve curve = IZonkCurve(vm.envAddress("ZONK_CURVE_ADDRESS"));
        address token = vm.envAddress("ZONK_TOKEN_ADDRESS");
        uint256 deadline = vm.envUint("GRADUATION_DEADLINE");
        (uint256 tokenAmount, uint256 quoteAmount) = curve.quoteGraduation(token);
        require(tokenAmount != 0 && quoteAmount != 0, "graduation liquidity required");

        vm.startBroadcast(deployerPrivateKey);
        record = curve.graduate(token, deadline);
        vm.stopBroadcast();

        console2.log("token", token);
        console2.log("liquidityToken", record.liquidityToken);
        console2.log("tokenAmount", record.tokenAmount);
        console2.log("quoteAmount", record.quoteAmount);
        console2.log("liquidityAmount", record.liquidityAmount);
        console2.log("lockId", record.lockId);
        console2.log("unlockTimestamp", record.unlockTimestamp);
    }
}
