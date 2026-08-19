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

/// @notice Base Mainnet deployment path for the validated endpoint-cp-v3 stack.
/// @dev `run()` requires `msg.sender == EXPECTED_MAINNET_DEPLOYER`, then broadcasts
/// as that validated caller. Foundry `--sender` sets `msg.sender`. `--account`
/// only unlocks a keystore for signing and does **not** set `msg.sender`.
/// Simulation may use `--sender EXPECTED_MAINNET_DEPLOYER`. Keystore-backed
/// signing/broadcast MUST use BOTH `--account zonk-mainnet-deployer` AND
/// `--sender 0x2e9f4a39F0530FC8521997d9eC634A637d49FBac`. Never `--private-key`.
/// Never a raw key in env. This script never reads `DEPLOYER_PRIVATE_KEY` and
/// never calls `acceptOwnership()`. Network submission still requires the
/// Foundry CLI `--broadcast` flag as a separate operator step.
contract DeployV3BaseMainnet is Script {
    uint256 public constant BASE_MAINNET_CHAIN_ID = 8453;
    uint24 internal constant POOL_FEE = 10_000;
    int24 internal constant TICK_SPACING = 200;
    bytes32 internal constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v3");

    address public constant CANONICAL_UNISWAP_V3_FACTORY = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
    address public constant CANONICAL_WETH = 0x4200000000000000000000000000000000000006;
    address public constant CANONICAL_NONFUNGIBLE_POSITION_MANAGER = 0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1;
    address public constant EXPECTED_MAINNET_DEPLOYER = 0x2e9f4a39F0530FC8521997d9eC634A637d49FBac;
    address public constant PROTOCOL_GOVERNANCE_SAFE = 0x71B20D47152Cdf6f9bb1b0CCd0C0FBA52b86a102;
    address public constant COMMUNITY_TREASURY_SAFE = 0x11Dbc46C527a76EE9bf167835478EC06F73B7f4b;

    struct Config {
        address deployer;
        address treasury;
        address communityTreasury;
        address uniswapFactory;
        address weth;
        address positionManager;
    }

    struct Deployed {
        FeeManagerV3 feeManager;
        GraduationManagerV3 graduationManager;
        ZonkFactoryV3 factory;
        TokenCommunityVaultV3 communityVault;
        TraderRewardsVaultV3 rewardsVault;
        TraderRewardsDistributorV3 rewardsDistributor;
        PermanentLPFeeVaultV3 feeVault;
        PermanentLPCustodianDeployerV3 custodianDeployer;
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
        _requireBaseMainnet();
        Config memory config = _loadConfig();
        _validateCanonical(config);
        address signer = msg.sender;
        require(signer == config.deployer, "unexpected deployment signer");

        // Broadcast as the validated caller (`--sender`), never a raw private key.
        // `--account` is not read here and does not set `msg.sender`.
        vm.startBroadcast(signer);
        Deployed memory deployed = _deployGraph(config, signer);
        _assertBootstrapConsumed(deployed);
        _initiateOwnershipHandoff(deployed, config);
        vm.stopBroadcast();

        _verify(deployed, config);
        _verifyEcosystem(deployed, config);
        _verifyOwnershipHandoff(deployed, config);
        _log(deployed);
        return (
            deployed.feeManager,
            deployed.graduationManager,
            deployed.factory,
            deployed.communityVault,
            deployed.rewardsVault,
            deployed.rewardsDistributor,
            deployed.feeVault,
            deployed.custodianDeployer
        );
    }

    function _canonicalConfig() internal pure returns (Config memory config) {
        config.deployer = EXPECTED_MAINNET_DEPLOYER;
        config.treasury = PROTOCOL_GOVERNANCE_SAFE;
        config.communityTreasury = COMMUNITY_TREASURY_SAFE;
        config.uniswapFactory = CANONICAL_UNISWAP_V3_FACTORY;
        config.weth = CANONICAL_WETH;
        config.positionManager = CANONICAL_NONFUNGIBLE_POSITION_MANAGER;
    }

    function _requireCanonicalAddresses(
        address treasury,
        address communityTreasury,
        address uniswapFactory,
        address weth,
        address positionManager
    ) internal pure {
        if (treasury != PROTOCOL_GOVERNANCE_SAFE) revert("canonical treasury mismatch");
        if (communityTreasury != COMMUNITY_TREASURY_SAFE) revert("canonical community treasury mismatch");
        if (uniswapFactory != CANONICAL_UNISWAP_V3_FACTORY) revert("canonical factory mismatch");
        if (weth != CANONICAL_WETH) revert("canonical WETH mismatch");
        if (positionManager != CANONICAL_NONFUNGIBLE_POSITION_MANAGER) revert("canonical NPM mismatch");
    }

    function _loadConfig() internal view returns (Config memory config) {
        _requireCanonicalAddresses(
            vm.envAddress("V3_TREASURY_SAFE"),
            vm.envAddress("V3_COMMUNITY_TREASURY_SAFE"),
            vm.envAddress("BASE_MAINNET_UNISWAP_V3_FACTORY"),
            vm.envAddress("BASE_MAINNET_WETH"),
            vm.envAddress("BASE_MAINNET_NONFUNGIBLE_POSITION_MANAGER")
        );
        config = _canonicalConfig();
    }

    function _validateCanonical(Config memory config) internal view {
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

    function _deployGraph(Config memory config, address signer) internal returns (Deployed memory deployed) {
        deployed.feeManager = new FeeManagerV3(signer, config.treasury);
        deployed.graduationManager = new GraduationManagerV3(config.uniswapFactory, config.weth);
        deployed.factory = new ZonkFactoryV3(address(deployed.feeManager), address(deployed.graduationManager));
        deployed.feeManager.setFactoryOnce(address(deployed.factory));
        deployed.graduationManager.setFactoryOnce(address(deployed.factory));
        deployed.communityVault =
            new TokenCommunityVaultV3(signer, config.communityTreasury, address(deployed.feeManager));
        deployed.rewardsVault = new TraderRewardsVaultV3(signer, address(deployed.feeManager));
        deployed.rewardsDistributor = new TraderRewardsDistributorV3(signer, address(deployed.rewardsVault));
        deployed.rewardsVault.setDistributorOnce(address(deployed.rewardsDistributor));
        deployed.feeManager.bindEcosystemVaultsOnce(address(deployed.communityVault), address(deployed.rewardsVault));
        deployed.feeVault = new PermanentLPFeeVaultV3(
            address(deployed.graduationManager),
            address(deployed.feeManager),
            address(deployed.communityVault),
            address(deployed.rewardsVault)
        );
        deployed.communityVault.setPermanentLPFeeVaultOnce(address(deployed.feeVault));
        deployed.rewardsVault.setPermanentLPFeeVaultOnce(address(deployed.feeVault));
        deployed.custodianDeployer = new PermanentLPCustodianDeployerV3(
            address(deployed.graduationManager), address(deployed.feeVault), config.positionManager
        );
        deployed.graduationManager
            .bindDependenciesOnce(
                address(deployed.feeVault), address(deployed.custodianDeployer), config.positionManager
            );
    }

    function _assertBootstrapConsumed(Deployed memory deployed) internal view {
        require(deployed.feeManager.factoryBootstrapAuthority() == address(0), "fee manager factory bootstrap live");
        require(deployed.feeManager.ecosystemBootstrapAuthority() == address(0), "ecosystem bootstrap live");
        require(deployed.graduationManager.factoryBootstrapAuthority() == address(0), "manager factory bootstrap live");
        require(
            deployed.graduationManager.dependencyBootstrapAuthority() == address(0), "manager dependency bootstrap live"
        );
        require(deployed.communityVault.lpFeeVaultBootstrapAuthority() == address(0), "community LP bootstrap live");
        require(deployed.rewardsVault.bootstrapAuthority() == address(0), "rewards bootstrap live");
        require(
            deployed.feeVault.custodianDeployerBootstrapAuthority() == address(0), "LP vault deployer bootstrap live"
        );
    }

    function _initiateOwnershipHandoff(Deployed memory deployed, Config memory config) internal {
        deployed.feeManager.transferOwnership(config.treasury);
        deployed.communityVault.transferOwnership(config.treasury);
        deployed.rewardsDistributor.transferOwnership(config.treasury);
    }

    function _verify(Deployed memory deployed, Config memory config) internal view {
        require(deployed.feeManager.factory() == address(deployed.factory), "fee manager factory mismatch");
        require(deployed.graduationManager.factory() == address(deployed.factory), "manager factory mismatch");
        require(address(deployed.factory.feeManager()) == address(deployed.feeManager), "factory fee manager mismatch");
        require(
            address(deployed.factory.graduationManager()) == address(deployed.graduationManager),
            "factory manager mismatch"
        );
        require(
            deployed.feeVault.factory() == address(deployed.factory)
                && deployed.feeVault.graduationManager() == address(deployed.graduationManager)
        );
        require(deployed.feeVault.weth() == config.weth, "vault WETH mismatch");
        require(deployed.custodianDeployer.feeVault() == address(deployed.feeVault));
        require(deployed.custodianDeployer.graduationManager() == address(deployed.graduationManager));
        require(deployed.custodianDeployer.nonfungiblePositionManager() == config.positionManager);
        require(deployed.graduationManager.permanentLPFeeVault() == address(deployed.feeVault));
        require(deployed.graduationManager.permanentLPCustodianDeployer() == address(deployed.custodianDeployer));
        require(deployed.graduationManager.nonfungiblePositionManager() == config.positionManager);
        address executor = deployed.custodianDeployer.settlementExecutor();
        require(executor.code.length != 0, "executor has no code");
        require(IGraduationSettlementExecutorV3(executor).graduationManager() == address(deployed.graduationManager));
        require(IGraduationSettlementExecutorV3(executor).nonfungiblePositionManager() == config.positionManager);
        require(IGraduationSettlementExecutorV3(executor).weth() == config.weth);
        require(
            deployed.graduationManager.uniswapV3Factory() == config.uniswapFactory, "manager canonical factory mismatch"
        );
        require(deployed.feeManager.treasury() == config.treasury, "protocol treasury mismatch");
        require(deployed.factory.protocolVersionHash() == PROTOCOL_VERSION_HASH, "factory version mismatch");
        require(deployed.feeManager.protocolVersionHash() == PROTOCOL_VERSION_HASH, "fee manager version mismatch");
        require(
            deployed.feeManager.feePolicyHash() == EndpointConstantsV3.FEE_POLICY_HASH, "fee manager policy mismatch"
        );
        require(deployed.feeVault.feePolicyHash() == EndpointConstantsV3.FEE_POLICY_HASH, "LP vault policy mismatch");
        require(deployed.graduationManager.protocolVersionHash() == PROTOCOL_VERSION_HASH, "manager version mismatch");
    }

    function _verifyEcosystem(Deployed memory deployed, Config memory config) internal view {
        require(
            deployed.feeManager.communityVault() == address(deployed.communityVault),
            "fee manager community vault mismatch"
        );
        require(
            deployed.feeManager.traderRewardsVault() == address(deployed.rewardsVault),
            "fee manager rewards vault mismatch"
        );
        require(deployed.communityVault.feeManager() == address(deployed.feeManager), "community fee manager mismatch");
        require(deployed.rewardsVault.feeManager() == address(deployed.feeManager), "rewards fee manager mismatch");
        require(
            deployed.communityVault.permanentLPFeeVault() == address(deployed.feeVault), "community LP vault mismatch"
        );
        require(deployed.rewardsVault.permanentLPFeeVault() == address(deployed.feeVault), "rewards LP vault mismatch");
        require(
            deployed.rewardsVault.distributor() == address(deployed.rewardsDistributor), "rewards distributor mismatch"
        );
        require(
            deployed.rewardsDistributor.rewardsVault() == address(deployed.rewardsVault), "distributor vault mismatch"
        );
        require(deployed.feeVault.communityVault() == address(deployed.communityVault), "LP community vault mismatch");
        require(deployed.feeVault.traderRewardsVault() == address(deployed.rewardsVault), "LP rewards vault mismatch");
        require(deployed.communityVault.treasury() == config.communityTreasury, "community treasury mismatch");
        require(deployed.communityVault.protocolVersionHash() == PROTOCOL_VERSION_HASH, "community version mismatch");
        require(deployed.rewardsVault.protocolVersionHash() == PROTOCOL_VERSION_HASH, "rewards vault version mismatch");
        require(
            deployed.rewardsDistributor.protocolVersionHash() == PROTOCOL_VERSION_HASH, "distributor version mismatch"
        );
        require(
            deployed.communityVault.feePolicyHash() == EndpointConstantsV3.FEE_POLICY_HASH, "community policy mismatch"
        );
        require(
            deployed.rewardsVault.feePolicyHash() == EndpointConstantsV3.FEE_POLICY_HASH,
            "rewards vault policy mismatch"
        );
        require(
            deployed.rewardsDistributor.feePolicyHash() == EndpointConstantsV3.FEE_POLICY_HASH,
            "distributor policy mismatch"
        );
    }

    function _verifyOwnershipHandoff(Deployed memory deployed, Config memory config) internal view {
        require(deployed.feeManager.owner() == config.deployer, "fee manager owner transferred too early");
        require(deployed.communityVault.owner() == config.deployer, "community owner transferred too early");
        require(deployed.rewardsDistributor.owner() == config.deployer, "distributor owner transferred too early");
        require(deployed.feeManager.pendingOwner() == config.treasury, "fee manager pending owner mismatch");
        require(deployed.communityVault.pendingOwner() == config.treasury, "community pending owner mismatch");
        require(deployed.rewardsDistributor.pendingOwner() == config.treasury, "distributor pending owner mismatch");
    }

    function _log(Deployed memory deployed) internal view {
        console2.log("feeManagerV3", address(deployed.feeManager));
        console2.log("graduationManagerV3", address(deployed.graduationManager));
        console2.log("zonkFactoryV3", address(deployed.factory));
        console2.log("tokenCommunityVaultV3", address(deployed.communityVault));
        console2.log("traderRewardsVaultV3", address(deployed.rewardsVault));
        console2.log("traderRewardsDistributorV3", address(deployed.rewardsDistributor));
        console2.log("permanentLPFeeVaultV3", address(deployed.feeVault));
        console2.log("permanentLPCustodianDeployerV3", address(deployed.custodianDeployer));
        console2.log("settlementExecutorV3", deployed.custodianDeployer.settlementExecutor());
        console2.log("pendingOwner", PROTOCOL_GOVERNANCE_SAFE);
        console2.log("v3 mainnet deployment verification", true);
    }

    function _requireBaseMainnet() internal view {
        require(block.chainid == BASE_MAINNET_CHAIN_ID, "Base Mainnet chain required");
    }
}
