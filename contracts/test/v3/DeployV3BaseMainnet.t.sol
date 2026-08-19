// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DeployV3BaseMainnet} from "../../script/DeployV3BaseMainnet.s.sol";
import {FeeManagerV3} from "../../src/v3/FeeManagerV3.sol";
import {GraduationManagerV3} from "../../src/v3/GraduationManagerV3.sol";
import {PermanentLPCustodianDeployerV3} from "../../src/v3/PermanentLPCustodianDeployerV3.sol";
import {PermanentLPFeeVaultV3} from "../../src/v3/PermanentLPFeeVaultV3.sol";
import {TokenCommunityVaultV3} from "../../src/v3/TokenCommunityVaultV3.sol";
import {TraderRewardsDistributorV3} from "../../src/v3/TraderRewardsDistributorV3.sol";
import {TraderRewardsVaultV3} from "../../src/v3/TraderRewardsVaultV3.sol";
import {ZonkFactoryV3} from "../../src/v3/ZonkFactoryV3.sol";
import {IGraduationSettlementExecutorV3} from "../../src/v3/interfaces/IGraduationSettlementExecutorV3.sol";
import {INonfungiblePositionManagerV3} from "../../src/v3/interfaces/INonfungiblePositionManagerV3.sol";
import {IUniswapV3FactoryMinimal} from "../../src/v3/interfaces/uniswap/IUniswapV3FactoryMinimal.sol";
import {EndpointConstantsV3} from "../../src/v3/libraries/EndpointConstantsV3.sol";
import {MockNonfungiblePositionManagerV3} from "./mocks/MockNonfungiblePositionManagerV3.sol";
import {MockUniswapV3FactoryV3, MockWETHV3} from "./mocks/MockUniswapV3.sol";

/// @dev Calls the real script `run()` so `msg.sender` is this contract.
contract DeployV3BaseMainnetRunProxy {
    function run(DeployV3BaseMainnet script)
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
        return script.run();
    }
}

/// @dev Local/fork harness: same graph and handoff as the script, without
/// `forge script --broadcast` and without reading a private key.
contract DeployV3BaseMainnetHarness is DeployV3BaseMainnet {
    function requireBaseMainnet() external view {
        _requireBaseMainnet();
    }

    function requireCanonicalAddresses(
        address treasury,
        address communityTreasury,
        address uniswapFactory,
        address weth,
        address positionManager
    ) external pure {
        _requireCanonicalAddresses(treasury, communityTreasury, uniswapFactory, weth, positionManager);
    }

    function validateCanonicalDependencies() external view {
        _validateCanonical(_canonicalConfig());
    }

    function loadConfigFromEnv() external view {
        _loadConfig();
    }

    function execute()
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
        Config memory config = _canonicalConfig();
        _validateCanonical(config);
        address signer = config.deployer;
        vm.startBroadcast(signer);
        Deployed memory deployed = _deployGraph(config, signer);
        _assertBootstrapConsumed(deployed);
        _initiateOwnershipHandoff(deployed, config);
        vm.stopBroadcast();
        _verify(deployed, config);
        _verifyEcosystem(deployed, config);
        _verifyOwnershipHandoff(deployed, config);
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
}

contract DeployV3BaseMainnetTest is Test {
    uint256 private constant PINNED_MAINNET_BLOCK = 48_887_205;
    bytes32 private constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v3");

    DeployV3BaseMainnetHarness internal harness;

    address internal deployer;
    address internal protocolSafe;
    address internal communitySafe;
    address internal factoryAddr;
    address internal wethAddr;
    address internal npmAddr;

    function setUp() public {
        harness = new DeployV3BaseMainnetHarness();
        deployer = harness.EXPECTED_MAINNET_DEPLOYER();
        protocolSafe = harness.PROTOCOL_GOVERNANCE_SAFE();
        communitySafe = harness.COMMUNITY_TREASURY_SAFE();
        factoryAddr = harness.CANONICAL_UNISWAP_V3_FACTORY();
        wethAddr = harness.CANONICAL_WETH();
        npmAddr = harness.CANONICAL_NONFUNGIBLE_POSITION_MANAGER();
        vm.chainId(harness.BASE_MAINNET_CHAIN_ID());
        _stubCanonicalDependencies();
        vm.deal(deployer, 100 ether);
    }

    function testRejectsNon8453Chain() public {
        vm.chainId(84_532);
        vm.expectRevert(bytes("Base Mainnet chain required"));
        harness.requireBaseMainnet();

        vm.chainId(1);
        vm.expectRevert(bytes("Base Mainnet chain required"));
        harness.requireBaseMainnet();
    }

    function testAcceptsCanonical8453Chain() public view {
        harness.requireBaseMainnet();
        harness.validateCanonicalDependencies();
    }

    function testRejectsWrongCanonicalFactory() public {
        vm.expectRevert(bytes("canonical factory mismatch"));
        harness.requireCanonicalAddresses(protocolSafe, communitySafe, address(0x1111), wethAddr, npmAddr);
    }

    function testRejectsWrongCanonicalWeth() public {
        vm.expectRevert(bytes("canonical WETH mismatch"));
        harness.requireCanonicalAddresses(protocolSafe, communitySafe, factoryAddr, address(0x2222), npmAddr);
    }

    function testRejectsWrongCanonicalNpm() public {
        vm.expectRevert(bytes("canonical NPM mismatch"));
        harness.requireCanonicalAddresses(protocolSafe, communitySafe, factoryAddr, wethAddr, address(0x3333));
    }

    function testRejectsWrongProtocolTreasury() public {
        vm.expectRevert(bytes("canonical treasury mismatch"));
        harness.requireCanonicalAddresses(address(0x4444), communitySafe, factoryAddr, wethAddr, npmAddr);
    }

    function testRejectsWrongCommunityTreasury() public {
        vm.expectRevert(bytes("canonical community treasury mismatch"));
        harness.requireCanonicalAddresses(protocolSafe, address(0x5555), factoryAddr, wethAddr, npmAddr);
    }

    function testRejectsMissingCanonicalCode() public {
        vm.etch(factoryAddr, "");
        vm.expectRevert(bytes("invalid canonical dependency"));
        harness.validateCanonicalDependencies();
    }

    function testRejectsWrongTickSpacing() public {
        vm.mockCall(
            factoryAddr,
            abi.encodeWithSelector(IUniswapV3FactoryMinimal.feeAmountTickSpacing.selector, uint24(10_000)),
            abi.encode(int24(60))
        );
        vm.expectRevert(bytes("canonical fee tier mismatch"));
        harness.validateCanonicalDependencies();
    }

    function testRejectsNpmRelationshipMismatch() public {
        vm.mockCall(
            npmAddr, abi.encodeWithSelector(INonfungiblePositionManagerV3.factory.selector), abi.encode(address(0xabc))
        );
        vm.expectRevert(bytes("canonical NPM relationship mismatch"));
        harness.validateCanonicalDependencies();
    }

    /// forge-config: default.isolate = true
    function testRunRejectsUnexpectedSigner() public {
        DeployV3BaseMainnet script = new DeployV3BaseMainnet();
        _setCanonicalEnv();
        vm.expectRevert(bytes("unexpected deployment signer"));
        script.run();
    }

    /// forge-config: default.isolate = true
    function testRunSucceedsWhenCalledByExpectedMainnetDeployer() public {
        DeployV3BaseMainnet script = new DeployV3BaseMainnet();
        DeployV3BaseMainnetRunProxy proxy = new DeployV3BaseMainnetRunProxy();
        vm.etch(deployer, address(proxy).code);
        _setCanonicalEnv();

        (
            FeeManagerV3 feeManager,
            GraduationManagerV3 graduationManager,,
            TokenCommunityVaultV3 communityVault,
            TraderRewardsVaultV3 rewardsVault,
            TraderRewardsDistributorV3 distributor,
            PermanentLPFeeVaultV3 feeVault,
        ) = DeployV3BaseMainnetRunProxy(deployer).run(script);

        assertEq(feeManager.factoryBootstrapAuthority(), address(0));
        assertEq(feeManager.ecosystemBootstrapAuthority(), address(0));
        assertEq(graduationManager.factoryBootstrapAuthority(), address(0));
        assertEq(graduationManager.dependencyBootstrapAuthority(), address(0));
        assertEq(communityVault.lpFeeVaultBootstrapAuthority(), address(0));
        assertEq(rewardsVault.bootstrapAuthority(), address(0));
        assertEq(feeVault.custodianDeployerBootstrapAuthority(), address(0));

        assertEq(feeManager.owner(), deployer);
        assertEq(communityVault.owner(), deployer);
        assertEq(distributor.owner(), deployer);
        assertEq(feeManager.pendingOwner(), protocolSafe);
        assertEq(communityVault.pendingOwner(), protocolSafe);
        assertEq(distributor.pendingOwner(), protocolSafe);
    }

    function testRunRejectsNon8453Chain() public {
        DeployV3BaseMainnet script = new DeployV3BaseMainnet();
        vm.chainId(84_532);
        vm.expectRevert(bytes("Base Mainnet chain required"));
        script.run();
    }

    function testDeploysCanonicalGraphBindingsAndHashes() public {
        (
            FeeManagerV3 feeManager,
            GraduationManagerV3 graduationManager,
            ZonkFactoryV3 factory,
            TokenCommunityVaultV3 communityVault,
            TraderRewardsVaultV3 rewardsVault,
            TraderRewardsDistributorV3 rewardsDistributor,
            PermanentLPFeeVaultV3 feeVault,
            PermanentLPCustodianDeployerV3 custodianDeployer
        ) = harness.execute();

        assertEq(feeManager.factory(), address(factory));
        assertEq(graduationManager.factory(), address(factory));
        assertEq(address(factory.feeManager()), address(feeManager));
        assertEq(address(factory.graduationManager()), address(graduationManager));
        assertEq(feeVault.factory(), address(factory));
        assertEq(feeVault.graduationManager(), address(graduationManager));
        assertEq(feeVault.weth(), wethAddr);
        assertEq(custodianDeployer.feeVault(), address(feeVault));
        assertEq(custodianDeployer.graduationManager(), address(graduationManager));
        assertEq(custodianDeployer.nonfungiblePositionManager(), npmAddr);
        assertEq(graduationManager.permanentLPFeeVault(), address(feeVault));
        assertEq(graduationManager.permanentLPCustodianDeployer(), address(custodianDeployer));
        assertEq(graduationManager.nonfungiblePositionManager(), npmAddr);
        assertEq(graduationManager.uniswapV3Factory(), factoryAddr);
        assertEq(feeManager.communityVault(), address(communityVault));
        assertEq(feeManager.traderRewardsVault(), address(rewardsVault));
        assertEq(communityVault.feeManager(), address(feeManager));
        assertEq(rewardsVault.feeManager(), address(feeManager));
        assertEq(communityVault.permanentLPFeeVault(), address(feeVault));
        assertEq(rewardsVault.permanentLPFeeVault(), address(feeVault));
        assertEq(rewardsVault.distributor(), address(rewardsDistributor));
        assertEq(rewardsDistributor.rewardsVault(), address(rewardsVault));
        assertEq(feeVault.communityVault(), address(communityVault));
        assertEq(feeVault.traderRewardsVault(), address(rewardsVault));
        address executor = custodianDeployer.settlementExecutor();
        assertGt(executor.code.length, 0);
        assertEq(IGraduationSettlementExecutorV3(executor).graduationManager(), address(graduationManager));
        assertEq(IGraduationSettlementExecutorV3(executor).nonfungiblePositionManager(), npmAddr);
        assertEq(IGraduationSettlementExecutorV3(executor).weth(), wethAddr);
        assertEq(graduationManager.settlementExecutor(), executor);

        assertEq(factory.protocolVersionHash(), PROTOCOL_VERSION_HASH);
        assertEq(feeManager.protocolVersionHash(), PROTOCOL_VERSION_HASH);
        assertEq(graduationManager.protocolVersionHash(), PROTOCOL_VERSION_HASH);
        assertEq(communityVault.protocolVersionHash(), PROTOCOL_VERSION_HASH);
        assertEq(rewardsVault.protocolVersionHash(), PROTOCOL_VERSION_HASH);
        assertEq(rewardsDistributor.protocolVersionHash(), PROTOCOL_VERSION_HASH);
        assertEq(feeManager.feePolicyHash(), EndpointConstantsV3.FEE_POLICY_HASH);
        assertEq(communityVault.feePolicyHash(), EndpointConstantsV3.FEE_POLICY_HASH);
        assertEq(rewardsVault.feePolicyHash(), EndpointConstantsV3.FEE_POLICY_HASH);
        assertEq(rewardsDistributor.feePolicyHash(), EndpointConstantsV3.FEE_POLICY_HASH);
        assertEq(feeVault.feePolicyHash(), EndpointConstantsV3.FEE_POLICY_HASH);
    }

    function testConsumesAllBootstrapAuthoritiesBeforeHandoff() public {
        (
            FeeManagerV3 feeManager,
            GraduationManagerV3 graduationManager,,
            TokenCommunityVaultV3 communityVault,
            TraderRewardsVaultV3 rewardsVault,,
            PermanentLPFeeVaultV3 feeVault,
        ) = harness.execute();

        assertEq(feeManager.factoryBootstrapAuthority(), address(0));
        assertEq(feeManager.ecosystemBootstrapAuthority(), address(0));
        assertEq(graduationManager.factoryBootstrapAuthority(), address(0));
        assertEq(graduationManager.dependencyBootstrapAuthority(), address(0));
        assertEq(communityVault.lpFeeVaultBootstrapAuthority(), address(0));
        assertEq(rewardsVault.bootstrapAuthority(), address(0));
        assertEq(feeVault.custodianDeployerBootstrapAuthority(), address(0));
    }

    function testConfiguresProtocolAndCommunityTreasuries() public {
        (FeeManagerV3 feeManager,,, TokenCommunityVaultV3 communityVault,,,,) = harness.execute();
        assertEq(feeManager.treasury(), protocolSafe);
        assertEq(communityVault.treasury(), communitySafe);
        assertTrue(protocolSafe != communitySafe);
    }

    function testOwnershipHandoffSetsPendingOwnerAndKeepsDeployer() public {
        (FeeManagerV3 feeManager,,, TokenCommunityVaultV3 communityVault,, TraderRewardsDistributorV3 distributor,,) =
            harness.execute();

        assertEq(feeManager.owner(), deployer);
        assertEq(communityVault.owner(), deployer);
        assertEq(distributor.owner(), deployer);
        assertEq(feeManager.pendingOwner(), protocolSafe);
        assertEq(communityVault.pendingOwner(), protocolSafe);
        assertEq(distributor.pendingOwner(), protocolSafe);
    }

    function testScriptPathDoesNotAcceptOwnership() public {
        (FeeManagerV3 feeManager,,, TokenCommunityVaultV3 communityVault,, TraderRewardsDistributorV3 distributor,,) =
            harness.execute();

        assertTrue(feeManager.owner() != protocolSafe);
        assertTrue(communityVault.owner() != protocolSafe);
        assertTrue(distributor.owner() != protocolSafe);
        assertEq(feeManager.pendingOwner(), protocolSafe);
        assertEq(communityVault.pendingOwner(), protocolSafe);
        assertEq(distributor.pendingOwner(), protocolSafe);

        vm.prank(protocolSafe);
        feeManager.acceptOwnership();
        vm.prank(protocolSafe);
        communityVault.acceptOwnership();
        vm.prank(protocolSafe);
        distributor.acceptOwnership();
        assertEq(feeManager.owner(), protocolSafe);
        assertEq(communityVault.owner(), protocolSafe);
        assertEq(distributor.owner(), protocolSafe);
        assertEq(feeManager.pendingOwner(), address(0));
        assertEq(communityVault.pendingOwner(), address(0));
        assertEq(distributor.pendingOwner(), address(0));
    }

    function testSafeCanAcceptOwnershipOnlyAfterHandoff() public {
        (FeeManagerV3 feeManager,,,,,,,) = harness.execute();
        vm.prank(deployer);
        vm.expectRevert();
        feeManager.acceptOwnership();
        vm.prank(protocolSafe);
        feeManager.acceptOwnership();
        assertEq(feeManager.owner(), protocolSafe);
    }

    /// forge-config: default.isolate = true
    function testLoadConfigRequiresMatchingPublicEnv() public {
        vm.setEnv("V3_TREASURY_SAFE", vm.toString(protocolSafe));
        vm.setEnv("V3_COMMUNITY_TREASURY_SAFE", vm.toString(communitySafe));
        vm.setEnv("BASE_MAINNET_UNISWAP_V3_FACTORY", vm.toString(factoryAddr));
        vm.setEnv("BASE_MAINNET_WETH", vm.toString(wethAddr));
        vm.setEnv("BASE_MAINNET_NONFUNGIBLE_POSITION_MANAGER", vm.toString(npmAddr));
        harness.loadConfigFromEnv();

        vm.setEnv("V3_TREASURY_SAFE", vm.toString(address(0x4444)));
        vm.expectRevert(bytes("canonical treasury mismatch"));
        harness.loadConfigFromEnv();
    }

    function testForkDeploysAgainstCanonicalUniswapWhenRpcAvailable() public {
        string memory rpcURL = vm.envOr("BASE_MAINNET_RPC_URL", string(""));
        if (bytes(rpcURL).length == 0) {
            vm.skip(true, "BASE_MAINNET_RPC_URL is not configured");
            return;
        }

        vm.createSelectFork(rpcURL, PINNED_MAINNET_BLOCK);
        assertEq(block.chainid, 8453);
        assertGt(factoryAddr.code.length, 0);
        assertGt(wethAddr.code.length, 0);
        assertGt(npmAddr.code.length, 0);
        assertEq(IUniswapV3FactoryMinimal(factoryAddr).feeAmountTickSpacing(10_000), int24(200));
        assertEq(INonfungiblePositionManagerV3(npmAddr).factory(), factoryAddr);
        assertEq(INonfungiblePositionManagerV3(npmAddr).WETH9(), wethAddr);

        DeployV3BaseMainnetHarness forkHarness = new DeployV3BaseMainnetHarness();
        vm.deal(deployer, 100 ether);
        (
            FeeManagerV3 feeManager,
            GraduationManagerV3 graduationManager,
            ZonkFactoryV3 factory,
            TokenCommunityVaultV3 communityVault,
            TraderRewardsVaultV3 rewardsVault,
            TraderRewardsDistributorV3 rewardsDistributor,
            PermanentLPFeeVaultV3 feeVault,
            PermanentLPCustodianDeployerV3 custodianDeployer
        ) = forkHarness.execute();

        assertEq(feeManager.factory(), address(factory));
        assertEq(graduationManager.uniswapV3Factory(), factoryAddr);
        assertEq(custodianDeployer.nonfungiblePositionManager(), npmAddr);
        assertEq(feeManager.factoryBootstrapAuthority(), address(0));
        assertEq(feeManager.ecosystemBootstrapAuthority(), address(0));
        assertEq(graduationManager.factoryBootstrapAuthority(), address(0));
        assertEq(graduationManager.dependencyBootstrapAuthority(), address(0));
        assertEq(communityVault.lpFeeVaultBootstrapAuthority(), address(0));
        assertEq(rewardsVault.bootstrapAuthority(), address(0));
        assertEq(feeVault.custodianDeployerBootstrapAuthority(), address(0));
        assertEq(feeManager.treasury(), protocolSafe);
        assertEq(communityVault.treasury(), communitySafe);
        assertEq(feeManager.owner(), deployer);
        assertEq(communityVault.owner(), deployer);
        assertEq(rewardsDistributor.owner(), deployer);
        assertEq(feeManager.pendingOwner(), protocolSafe);
        assertEq(communityVault.pendingOwner(), protocolSafe);
        assertEq(rewardsDistributor.pendingOwner(), protocolSafe);
        assertEq(feeManager.protocolVersionHash(), PROTOCOL_VERSION_HASH);
        assertEq(feeManager.feePolicyHash(), EndpointConstantsV3.FEE_POLICY_HASH);
    }

    function _setCanonicalEnv() private {
        vm.setEnv("V3_TREASURY_SAFE", vm.toString(protocolSafe));
        vm.setEnv("V3_COMMUNITY_TREASURY_SAFE", vm.toString(communitySafe));
        vm.setEnv("BASE_MAINNET_UNISWAP_V3_FACTORY", vm.toString(factoryAddr));
        vm.setEnv("BASE_MAINNET_WETH", vm.toString(wethAddr));
        vm.setEnv("BASE_MAINNET_NONFUNGIBLE_POSITION_MANAGER", vm.toString(npmAddr));
    }

    function _stubCanonicalDependencies() private {
        MockUniswapV3FactoryV3 mockFactory = new MockUniswapV3FactoryV3();
        MockWETHV3 mockWeth = new MockWETHV3();
        MockNonfungiblePositionManagerV3 mockNpm = new MockNonfungiblePositionManagerV3(factoryAddr, wethAddr);
        vm.etch(factoryAddr, address(mockFactory).code);
        vm.etch(wethAddr, address(mockWeth).code);
        vm.etch(npmAddr, address(mockNpm).code);
        vm.mockCall(
            factoryAddr,
            abi.encodeWithSelector(IUniswapV3FactoryMinimal.feeAmountTickSpacing.selector, uint24(10_000)),
            abi.encode(int24(200))
        );
        vm.mockCall(
            npmAddr, abi.encodeWithSelector(INonfungiblePositionManagerV3.factory.selector), abi.encode(factoryAddr)
        );
        vm.mockCall(npmAddr, abi.encodeWithSelector(INonfungiblePositionManagerV3.WETH9.selector), abi.encode(wethAddr));
    }
}
