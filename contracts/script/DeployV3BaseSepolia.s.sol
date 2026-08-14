// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {FeeManagerV3} from "../src/v3/FeeManagerV3.sol";
import {GraduationManagerV3} from "../src/v3/GraduationManagerV3.sol";
import {ZonkFactoryV3} from "../src/v3/ZonkFactoryV3.sol";
import {PermanentLPFeeVaultV3} from "../src/v3/PermanentLPFeeVaultV3.sol";
import {PermanentLPCustodianDeployerV3} from "../src/v3/PermanentLPCustodianDeployerV3.sol";
import {IUniswapV3FactoryMinimal} from "../src/v3/interfaces/uniswap/IUniswapV3FactoryMinimal.sol";
import {INonfungiblePositionManagerV3} from "../src/v3/interfaces/INonfungiblePositionManagerV3.sol";
import {IGraduationSettlementExecutorV3} from "../src/v3/interfaces/IGraduationSettlementExecutorV3.sol";

/// @notice Deployment preparation for the validated endpoint-cp-v3 stack.
/// @dev This script is dry-run by default. Set V3_BROADCAST=true only during
/// an explicitly approved deployment; this file is never the legacy deployer.
contract DeployV3BaseSepolia is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;
    uint24 internal constant POOL_FEE = 10_000;
    int24 internal constant TICK_SPACING = 200;

    struct Config {
        address governance;
        address treasury;
        address uniswapFactory;
        address weth;
        address positionManager;
        bool broadcast;
        uint256 deployerPrivateKey;
    }

    function run()
        external
        returns (
            FeeManagerV3 feeManager,
            GraduationManagerV3 graduationManager,
            ZonkFactoryV3 factory,
            PermanentLPFeeVaultV3 feeVault,
            PermanentLPCustodianDeployerV3 custodianDeployer
        )
    {
        _requireBaseSepolia();
        Config memory config = _loadConfig();
        _validateCanonical(config);

        if (config.broadcast) vm.startBroadcast(config.deployerPrivateKey);
        feeManager = new FeeManagerV3(config.governance, config.treasury);
        graduationManager = new GraduationManagerV3(config.uniswapFactory, config.weth);
        factory = new ZonkFactoryV3(address(feeManager), address(graduationManager));
        feeManager.setFactoryOnce(address(factory));
        graduationManager.setFactoryOnce(address(factory));
        feeVault = new PermanentLPFeeVaultV3(address(graduationManager), address(feeManager));
        custodianDeployer =
            new PermanentLPCustodianDeployerV3(address(graduationManager), address(feeVault), config.positionManager);
        graduationManager.bindDependenciesOnce(address(feeVault), address(custodianDeployer), config.positionManager);
        if (config.broadcast) vm.stopBroadcast();

        _verify(
            feeManager,
            graduationManager,
            factory,
            feeVault,
            custodianDeployer,
            config.positionManager,
            config.weth,
            config.uniswapFactory
        );
        console2.log("feeManagerV3", address(feeManager));
        console2.log("graduationManagerV3", address(graduationManager));
        console2.log("zonkFactoryV3", address(factory));
        console2.log("permanentLPFeeVaultV3", address(feeVault));
        console2.log("permanentLPCustodianDeployerV3", address(custodianDeployer));
        console2.log("settlementExecutorV3", custodianDeployer.settlementExecutor());
        console2.log("v3 deployment verification", true);
    }

    function _loadConfig() private view returns (Config memory config) {
        config.governance = vm.envAddress("V3_GOVERNANCE_ADDRESS");
        config.treasury = vm.envAddress("V3_TREASURY_SAFE");
        config.uniswapFactory = vm.envAddress("BASE_SEPOLIA_UNISWAP_V3_FACTORY");
        config.weth = vm.envAddress("BASE_SEPOLIA_WETH");
        config.positionManager = vm.envAddress("BASE_SEPOLIA_NONFUNGIBLE_POSITION_MANAGER");
        config.broadcast = vm.envOr("V3_BROADCAST", false);
        if (config.broadcast) {
            config.deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
            require(
                vm.addr(config.deployerPrivateKey) == config.governance,
                "deployment signer must equal V3_GOVERNANCE_ADDRESS"
            );
        }
        if (config.governance == address(0) || config.treasury == address(0)) revert("zero governance/treasury");
    }

    function _validateCanonical(Config memory config) private view {
        if (
            config.uniswapFactory == address(0) || config.weth == address(0) || config.positionManager == address(0)
                || config.uniswapFactory.code.length == 0 || config.weth.code.length == 0
                || config.positionManager.code.length == 0
        ) revert("invalid canonical dependency");
        if (IUniswapV3FactoryMinimal(config.uniswapFactory).feeAmountTickSpacing(POOL_FEE) != TICK_SPACING) {
            revert("canonical fee tier mismatch");
        }
        if (
            INonfungiblePositionManagerV3(config.positionManager).factory() != config.uniswapFactory
                || INonfungiblePositionManagerV3(config.positionManager).WETH9() != config.weth
        ) revert("canonical NPM relationship mismatch");
    }

    function _verify(
        FeeManagerV3 feeManager,
        GraduationManagerV3 graduationManager,
        ZonkFactoryV3 factory,
        PermanentLPFeeVaultV3 feeVault,
        PermanentLPCustodianDeployerV3 custodianDeployer,
        address positionManager,
        address weth,
        address uniswapFactory
    ) private view {
        require(feeManager.factory() == address(factory), "fee manager factory mismatch");
        require(graduationManager.factory() == address(factory), "manager factory mismatch");
        require(address(factory.feeManager()) == address(feeManager), "factory fee manager mismatch");
        require(address(factory.graduationManager()) == address(graduationManager), "factory manager mismatch");
        require(feeVault.factory() == address(factory) && feeVault.graduationManager() == address(graduationManager));
        require(feeVault.weth() == weth, "vault WETH mismatch");
        require(custodianDeployer.feeVault() == address(feeVault));
        require(custodianDeployer.graduationManager() == address(graduationManager));
        require(custodianDeployer.nonfungiblePositionManager() == positionManager);
        require(graduationManager.permanentLPFeeVault() == address(feeVault));
        require(graduationManager.permanentLPCustodianDeployer() == address(custodianDeployer));
        require(graduationManager.nonfungiblePositionManager() == positionManager);
        address executor = custodianDeployer.settlementExecutor();
        require(executor.code.length != 0, "executor has no code");
        require(IGraduationSettlementExecutorV3(executor).graduationManager() == address(graduationManager));
        require(IGraduationSettlementExecutorV3(executor).nonfungiblePositionManager() == positionManager);
        require(IGraduationSettlementExecutorV3(executor).weth() == weth);
        require(graduationManager.uniswapV3Factory() == uniswapFactory, "manager canonical factory mismatch");
    }

    function _requireBaseSepolia() private view {
        require(block.chainid == BASE_SEPOLIA_CHAIN_ID, "Base Sepolia chain required");
    }
}
