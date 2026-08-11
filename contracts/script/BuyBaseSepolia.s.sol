// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IZonkCurve} from "../src/interfaces/IZonkCurve.sol";

/// @notice Quotes and executes a buy using the same max input.
contract BuyBaseSepolia is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;

    function run() external returns (uint256 reserveIn) {
        require(block.chainid == BASE_SEPOLIA_CHAIN_ID, "Base Sepolia chain required");

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        IZonkCurve curve = IZonkCurve(vm.envAddress("ZONK_CURVE_ADDRESS"));
        address token = vm.envAddress("ZONK_TOKEN_ADDRESS");
        uint256 tokenAmount = vm.envUint("BUY_TOKEN_AMOUNT");
        uint256 maxReserveIn = vm.envUint("BUY_MAX_RESERVE_IN");
        (reserveIn,,,) = curve.quoteBuy(token, tokenAmount);
        require(reserveIn <= maxReserveIn, "buy quote exceeds configured maximum");

        vm.startBroadcast(deployerPrivateKey);
        curve.buy{value: reserveIn}(token, tokenAmount, maxReserveIn);
        vm.stopBroadcast();

        console2.log("token", token);
        console2.log("tokenAmount", tokenAmount);
        console2.log("reserveIn", reserveIn);
    }
}
