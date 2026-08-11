// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ZonkFactory} from "../src/ZonkFactory.sol";

/// @notice Creates one fixed-supply token through the deployed factory.
contract CreateTokenBaseSepolia is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;

    function run() external returns (address token) {
        require(block.chainid == BASE_SEPOLIA_CHAIN_ID, "Base Sepolia chain required");

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        ZonkFactory factory = ZonkFactory(vm.envAddress("ZONK_FACTORY_ADDRESS"));
        string memory name = vm.envString("TOKEN_NAME");
        string memory symbol = vm.envString("TOKEN_SYMBOL");
        uint256 initialSupply = vm.envUint("TOKEN_INITIAL_SUPPLY");

        vm.startBroadcast(deployerPrivateKey);
        token = factory.createToken(name, symbol, initialSupply);
        vm.stopBroadcast();

        console2.log("token", token);
        console2.log("creator", vm.addr(deployerPrivateKey));
    }
}
