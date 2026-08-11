// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ZonkCurve} from "../src/ZonkCurve.sol";
import {ZonkFactory} from "../src/ZonkFactory.sol";
import {FeeManager} from "../src/fees/FeeManager.sol";
import {LiquidityManager} from "../src/liquidity/LiquidityManager.sol";

/// @notice Deploys the Phase 3 core architecture to Base Sepolia.
///
/// Required environment variables:
/// - DEPLOYER_PRIVATE_KEY: funded Base Sepolia deployer key, never committed
/// - GOVERNANCE_ADDRESS: initial AccessControl administrator/configurator
/// - PROTOCOL_TREASURY: authorized protocol fee claimant
/// - PROTOCOL_FEE_BPS and CREATOR_FEE_BPS: capped initial fee rates
/// - LP_BENEFICIARY: Safe or governance beneficiary after the enforced lock
/// - LP_LOCK_DURATION and MAX_LIQUIDITY_SLIPPAGE_BPS: liquidity safeguards
contract DeployBaseSepolia is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;

    struct DeploymentConfig {
        uint256 deployerPrivateKey;
        address governance;
        address protocolTreasury;
        address lpBeneficiary;
        uint16 protocolFeeBps;
        uint16 creatorFeeBps;
        uint16 liquiditySlippageBps;
        uint64 lockDuration;
    }

    function run()
        external
        returns (ZonkFactory factory, FeeManager feeManager, LiquidityManager liquidityManager, ZonkCurve curve)
    {
        _requireBaseSepolia();

        DeploymentConfig memory config = _loadConfig();

        vm.startBroadcast(config.deployerPrivateKey);
        factory = new ZonkFactory();
        feeManager =
            new FeeManager(config.governance, config.protocolTreasury, config.protocolFeeBps, config.creatorFeeBps);
        liquidityManager = new LiquidityManager(
            config.governance, config.lpBeneficiary, config.lockDuration, config.liquiditySlippageBps
        );
        curve = new ZonkCurve(address(factory), address(feeManager), address(liquidityManager));
        feeManager.grantRole(feeManager.CURVE_ROLE(), address(curve));
        liquidityManager.grantRole(liquidityManager.CURVE_ROLE(), address(curve));
        vm.stopBroadcast();

        console2.log("chainId", block.chainid);
        console2.log("deployer", vm.addr(config.deployerPrivateKey));
        console2.log("zonkFactory", address(factory));
        console2.log("feeManager", address(feeManager));
        console2.log("liquidityManager", address(liquidityManager));
        console2.log("lpLocker", address(liquidityManager.lpLocker()));
        console2.log("zonkCurve", address(curve));
        console2.log("governance", config.governance);
        console2.log("protocolTreasury", config.protocolTreasury);
    }

    function _loadConfig() private view returns (DeploymentConfig memory config) {
        config.deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        config.governance = vm.envAddress("GOVERNANCE_ADDRESS");
        string memory emptyValue = "";
        string memory protocolTreasuryValue = vm.envOr("PROTOCOL_TREASURY", emptyValue);
        require(bytes(protocolTreasuryValue).length != 0, "PROTOCOL_TREASURY is required");
        try vm.parseAddress(protocolTreasuryValue) returns (address parsedTreasury) {
            config.protocolTreasury = parsedTreasury;
        } catch {
            revert("PROTOCOL_TREASURY must be a valid address");
        }
        require(config.protocolTreasury != address(0), "PROTOCOL_TREASURY must be nonzero");
        config.lpBeneficiary = vm.envAddress("LP_BENEFICIARY");
        uint256 protocolFeeBpsValue = vm.envUint("PROTOCOL_FEE_BPS");
        uint256 creatorFeeBpsValue = vm.envUint("CREATOR_FEE_BPS");
        uint256 lockDurationValue = vm.envUint("LP_LOCK_DURATION");
        uint256 liquiditySlippageValue = vm.envUint("MAX_LIQUIDITY_SLIPPAGE_BPS");
        require(protocolFeeBpsValue <= type(uint16).max, "protocol fee does not fit uint16");
        require(creatorFeeBpsValue <= type(uint16).max, "creator fee does not fit uint16");
        // Values are bounded to uint16 immediately above.
        // forge-lint: disable-next-line(unsafe-typecast)
        config.protocolFeeBps = uint16(protocolFeeBpsValue);
        // Values are bounded to uint16 immediately above.
        // forge-lint: disable-next-line(unsafe-typecast)
        config.creatorFeeBps = uint16(creatorFeeBpsValue);
        require(lockDurationValue <= type(uint64).max, "lock duration does not fit uint64");
        require(liquiditySlippageValue <= type(uint16).max, "slippage does not fit uint16");
        // Values are bounded to uint64 immediately above.
        // forge-lint: disable-next-line(unsafe-typecast)
        config.lockDuration = uint64(lockDurationValue);
        // Values are bounded to uint16 immediately above.
        // forge-lint: disable-next-line(unsafe-typecast)
        config.liquiditySlippageBps = uint16(liquiditySlippageValue);
        require(vm.addr(config.deployerPrivateKey) == config.governance, "governance must execute deployment");
    }

    function _requireBaseSepolia() internal view {
        require(block.chainid == BASE_SEPOLIA_CHAIN_ID, "Base Sepolia chain required");
    }
}
