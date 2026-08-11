// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ZonkCurve} from "../src/ZonkCurve.sol";
import {ZonkToken} from "../src/ZonkToken.sol";

/// @notice Escrows a creator allocation and initializes one deployed curve.
contract SeedCurveBaseSepolia is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;

    function run() external {
        require(block.chainid == BASE_SEPOLIA_CHAIN_ID, "Base Sepolia chain required");

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address token = vm.envAddress("ZONK_TOKEN_ADDRESS");
        ZonkCurve curve = ZonkCurve(payable(vm.envAddress("ZONK_CURVE_ADDRESS")));
        uint256 curveSupply = vm.envUint("CURVE_SUPPLY");
        uint256 startingPrice = vm.envUint("CURVE_STARTING_PRICE");
        uint256 slope = vm.envUint("CURVE_SLOPE");
        uint256 graduationThreshold = vm.envUint("CURVE_GRADUATION_THRESHOLD");

        vm.startBroadcast(deployerPrivateKey);
        IERC20(token).approve(address(curve), curveSupply);
        curve.createCurve(token, curveSupply, startingPrice, slope, graduationThreshold);
        vm.stopBroadcast();

        console2.log("token", token);
        console2.log("creator", ZonkToken(token).creator());
        console2.log("curve", address(curve));
    }
}
