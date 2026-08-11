// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IZonkCurve} from "../src/interfaces/IZonkCurve.sol";

/// @notice Quotes and executes a sell after approving the curve escrow.
contract SellBaseSepolia is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;

    function run() external returns (uint256 reserveOut) {
        require(block.chainid == BASE_SEPOLIA_CHAIN_ID, "Base Sepolia chain required");

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        IZonkCurve curve = IZonkCurve(vm.envAddress("ZONK_CURVE_ADDRESS"));
        address token = vm.envAddress("ZONK_TOKEN_ADDRESS");
        uint256 tokenAmount = vm.envUint("SELL_TOKEN_AMOUNT");
        uint256 minReserveOut = vm.envUint("SELL_MIN_RESERVE_OUT");
        (reserveOut,,,) = curve.quoteSell(token, tokenAmount);
        require(reserveOut >= minReserveOut, "sell quote below configured minimum");

        vm.startBroadcast(deployerPrivateKey);
        IERC20(token).approve(address(curve), tokenAmount);
        curve.sell(token, tokenAmount, minReserveOut);
        vm.stopBroadcast();

        console2.log("token", token);
        console2.log("tokenAmount", tokenAmount);
        console2.log("reserveOut", reserveOut);
    }
}
