// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {FeeManagerV3} from "../src/v3/FeeManagerV3.sol";
import {GraduationManagerV3} from "../src/v3/GraduationManagerV3.sol";
import {ZonkFactoryV3} from "../src/v3/ZonkFactoryV3.sol";
import {PermanentLPFeeVaultV3} from "../src/v3/PermanentLPFeeVaultV3.sol";
import {PermanentLPCustodianDeployerV3} from "../src/v3/PermanentLPCustodianDeployerV3.sol";
import {TokenCommunityVaultV3} from "../src/v3/TokenCommunityVaultV3.sol";
import {TraderRewardsDistributorV3} from "../src/v3/TraderRewardsDistributorV3.sol";
import {TraderRewardsVaultV3} from "../src/v3/TraderRewardsVaultV3.sol";
import {IUniswapV3FactoryMinimal} from "../src/v3/interfaces/uniswap/IUniswapV3FactoryMinimal.sol";
import {INonfungiblePositionManagerV3} from "../src/v3/interfaces/INonfungiblePositionManagerV3.sol";
import {IGraduationSettlementExecutorV3} from "../src/v3/interfaces/IGraduationSettlementExecutorV3.sol";
import {EndpointConstantsV3} from "../src/v3/libraries/EndpointConstantsV3.sol";

/// @notice Deployment preparation for the validated endpoint-cp-v3 stack.
/// @dev Simulation and broadcast share the same signer-sensitive graph via
/// `vm.startBroadcast`. Actual network submission is controlled only by
/// `forge script --broadcast`. This file is never the legacy deployer.
contract DeployV3BaseSepolia is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;
    uint24 internal constant POOL_FEE = 10_000;
    int24 internal constant TICK_SPACING = 200;
    bytes32 internal constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v3");

    struct Config {
        address governance;
        address treasury;
        address communityTreasury;
        address uniswapFactory;
        address weth;
        address positionManager;
        uint256 deployerPrivateKey;
    }

    function run()
        external
        returns (
            FeeManagerV3 feeManager,
            GraduationManagerV3 graduationManager,
            ZonkFactoryV3 factory,
            TokenCommunityVaultV3 communityVault,
            TraderRewardsVaultV3 rewardsVault,
            TraderRewardsDistributorV3 rewardsDistributor,
            PermanentLPFeeVaultV3 feeVault,
            PermanentLPCustodianDeployerV3 custodianDeployer
        )
    {
        _requireBaseSepolia();
        Config memory config = _loadConfig();
        _validateCanonical(config);

        vm.startBroadcast(config.deployerPrivateKey);
        feeManager = new FeeManagerV3(config.governance, config.treasury);
        graduationManager = new GraduationManagerV3(config.uniswapFactory, config.weth);
        factory = new ZonkFactoryV3(address(feeManager), address(graduationManager));
        feeManager.setFactoryOnce(address(factory));
        graduationManager.setFactoryOnce(address(factory));
        communityVault = new TokenCommunityVaultV3(config.governance, config.communityTreasury, address(feeManager));
        rewardsVault = new TraderRewardsVaultV3(config.governance, address(feeManager));
        rewardsDistributor = new TraderRewardsDistributorV3(config.governance, address(rewardsVault));
        rewardsVault.setDistributorOnce(address(rewardsDistributor));
        feeManager.bindEcosystemVaultsOnce(address(communityVault), address(rewardsVault));
        feeVault = new PermanentLPFeeVaultV3(
            address(graduationManager), address(feeManager), address(communityVault), address(rewardsVault)
        );
        communityVault.setPermanentLPFeeVaultOnce(address(feeVault));
        rewardsVault.setPermanentLPFeeVaultOnce(address(feeVault));
        custodianDeployer =
            new PermanentLPCustodianDeployerV3(address(graduationManager), address(feeVault), config.positionManager);
        graduationManager.bindDependenciesOnce(address(feeVault), address(custodianDeployer), config.positionManager);
        vm.stopBroadcast();

        _verify(feeManager, graduationManager, factory, feeVault, custodianDeployer, config);
        _verifyEcosystem(feeManager, communityVault, rewardsVault, rewardsDistributor, feeVault, config);
        console2.log("feeManagerV3", address(feeManager));
        console2.log("graduationManagerV3", address(graduationManager));
        console2.log("zonkFactoryV3", address(factory));
        console2.log("tokenCommunityVaultV3", address(communityVault));
        console2.log("traderRewardsVaultV3", address(rewardsVault));
        console2.log("traderRewardsDistributorV3", address(rewardsDistributor));
        console2.log("permanentLPFeeVaultV3", address(feeVault));
        console2.log("permanentLPCustodianDeployerV3", address(custodianDeployer));
        console2.log("settlementExecutorV3", custodianDeployer.settlementExecutor());
        console2.log("v3 deployment verification", true);
    }

    function _loadConfig() private view returns (Config memory config) {
        config.governance = vm.envAddress("V3_GOVERNANCE_ADDRESS");
        config.treasury = vm.envAddress("V3_TREASURY_SAFE");
        config.communityTreasury = vm.envAddress("V3_COMMUNITY_TREASURY_SAFE");
        config.uniswapFactory = vm.envAddress("BASE_SEPOLIA_UNISWAP_V3_FACTORY");
        config.weth = vm.envAddress("BASE_SEPOLIA_WETH");
        config.positionManager = vm.envAddress("BASE_SEPOLIA_NONFUNGIBLE_POSITION_MANAGER");
        config.deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        require(
            vm.addr(config.deployerPrivateKey) == config.governance,
            "deployment signer must equal V3_GOVERNANCE_ADDRESS"
        );
        if (config.governance == address(0) || config.treasury == address(0) || config.communityTreasury == address(0))
        {
            revert("zero governance/treasury");
        }
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
        Config memory config
    ) private view {
        require(feeManager.factory() == address(factory), "fee manager factory mismatch");
        require(graduationManager.factory() == address(factory), "manager factory mismatch");
        require(address(factory.feeManager()) == address(feeManager), "factory fee manager mismatch");
        require(address(factory.graduationManager()) == address(graduationManager), "factory manager mismatch");
        require(feeVault.factory() == address(factory) && feeVault.graduationManager() == address(graduationManager));
        require(feeVault.weth() == config.weth, "vault WETH mismatch");
        require(custodianDeployer.feeVault() == address(feeVault));
        require(custodianDeployer.graduationManager() == address(graduationManager));
        require(custodianDeployer.nonfungiblePositionManager() == config.positionManager);
        require(graduationManager.permanentLPFeeVault() == address(feeVault));
        require(graduationManager.permanentLPCustodianDeployer() == address(custodianDeployer));
        require(graduationManager.nonfungiblePositionManager() == config.positionManager);
        address executor = custodianDeployer.settlementExecutor();
        require(executor.code.length != 0, "executor has no code");
        require(IGraduationSettlementExecutorV3(executor).graduationManager() == address(graduationManager));
        require(IGraduationSettlementExecutorV3(executor).nonfungiblePositionManager() == config.positionManager);
        require(IGraduationSettlementExecutorV3(executor).weth() == config.weth);
        require(graduationManager.uniswapV3Factory() == config.uniswapFactory, "manager canonical factory mismatch");
        require(feeManager.factoryBootstrapAuthority() == address(0), "fee manager factory bootstrap live");
        require(graduationManager.factoryBootstrapAuthority() == address(0), "manager factory bootstrap live");
        require(graduationManager.dependencyBootstrapAuthority() == address(0), "manager dependency bootstrap live");
        require(feeVault.custodianDeployerBootstrapAuthority() == address(0), "LP vault deployer bootstrap live");
        require(feeManager.treasury() == config.treasury, "protocol treasury mismatch");
        require(feeManager.owner() == config.governance, "fee manager owner mismatch");
        require(feeManager.protocolVersionHash() == PROTOCOL_VERSION_HASH, "fee manager version mismatch");
        require(feeManager.feePolicyHash() == EndpointConstantsV3.FEE_POLICY_HASH, "fee manager policy mismatch");
        require(feeVault.feePolicyHash() == EndpointConstantsV3.FEE_POLICY_HASH, "LP vault policy mismatch");
    }

    function _verifyEcosystem(
        FeeManagerV3 feeManager,
        TokenCommunityVaultV3 communityVault,
        TraderRewardsVaultV3 rewardsVault,
        TraderRewardsDistributorV3 rewardsDistributor,
        PermanentLPFeeVaultV3 feeVault,
        Config memory config
    ) private view {
        require(feeManager.communityVault() == address(communityVault), "fee manager community vault mismatch");
        require(feeManager.traderRewardsVault() == address(rewardsVault), "fee manager rewards vault mismatch");
        require(communityVault.feeManager() == address(feeManager), "community fee manager mismatch");
        require(rewardsVault.feeManager() == address(feeManager), "rewards fee manager mismatch");
        require(communityVault.permanentLPFeeVault() == address(feeVault), "community LP vault mismatch");
        require(rewardsVault.permanentLPFeeVault() == address(feeVault), "rewards LP vault mismatch");
        require(rewardsVault.distributor() == address(rewardsDistributor), "rewards distributor mismatch");
        require(rewardsDistributor.rewardsVault() == address(rewardsVault), "distributor vault mismatch");
        require(feeVault.communityVault() == address(communityVault), "LP community vault mismatch");
        require(feeVault.traderRewardsVault() == address(rewardsVault), "LP rewards vault mismatch");
        require(feeManager.ecosystemBootstrapAuthority() == address(0), "ecosystem bootstrap live");
        require(communityVault.lpFeeVaultBootstrapAuthority() == address(0), "community LP bootstrap live");
        require(rewardsVault.bootstrapAuthority() == address(0), "rewards bootstrap live");
        require(communityVault.treasury() == config.communityTreasury, "community treasury mismatch");
        require(communityVault.owner() == config.governance, "community owner mismatch");
        require(rewardsDistributor.owner() == config.governance, "distributor owner mismatch");
        require(communityVault.protocolVersionHash() == PROTOCOL_VERSION_HASH, "community version mismatch");
        require(rewardsVault.protocolVersionHash() == PROTOCOL_VERSION_HASH, "rewards vault version mismatch");
        require(rewardsDistributor.protocolVersionHash() == PROTOCOL_VERSION_HASH, "distributor version mismatch");
        require(communityVault.feePolicyHash() == EndpointConstantsV3.FEE_POLICY_HASH, "community policy mismatch");
        require(rewardsVault.feePolicyHash() == EndpointConstantsV3.FEE_POLICY_HASH, "rewards vault policy mismatch");
        require(
            rewardsDistributor.feePolicyHash() == EndpointConstantsV3.FEE_POLICY_HASH, "distributor policy mismatch"
        );
    }

    function _requireBaseSepolia() private view {
        require(block.chainid == BASE_SEPOLIA_CHAIN_ID, "Base Sepolia chain required");
    }
}
