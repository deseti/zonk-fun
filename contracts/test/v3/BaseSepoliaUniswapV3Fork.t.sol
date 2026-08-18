// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EndpointConstantsV3} from "../../src/v3/libraries/EndpointConstantsV3.sol";
import {FeeManagerV3} from "../../src/v3/FeeManagerV3.sol";
import {GraduationManagerV3} from "../../src/v3/GraduationManagerV3.sol";
import {PermanentLPCustodianDeployerV3} from "../../src/v3/PermanentLPCustodianDeployerV3.sol";
import {PermanentLPCustodianV3} from "../../src/v3/PermanentLPCustodianV3.sol";
import {PermanentLPFeeVaultV3} from "../../src/v3/PermanentLPFeeVaultV3.sol";
import {PermanentResidualEscrowV3} from "../../src/v3/PermanentResidualEscrowV3.sol";
import {TokenCommunityVaultV3} from "../../src/v3/TokenCommunityVaultV3.sol";
import {TraderRewardsDistributorV3} from "../../src/v3/TraderRewardsDistributorV3.sol";
import {TraderRewardsVaultV3} from "../../src/v3/TraderRewardsVaultV3.sol";
import {TokenDeployerV3} from "../../src/v3/TokenDeployerV3.sol";
import {ZonkCurveV3} from "../../src/v3/ZonkCurveV3.sol";
import {ZonkFactoryV3} from "../../src/v3/ZonkFactoryV3.sol";
import {ZonkTokenV3} from "../../src/v3/ZonkTokenV3.sol";
import {IGraduationManagerV3} from "../../src/v3/interfaces/IGraduationManagerV3.sol";
import {INonfungiblePositionManagerV3} from "../../src/v3/interfaces/INonfungiblePositionManagerV3.sol";
import {IUniswapV3FactoryMinimal} from "../../src/v3/interfaces/uniswap/IUniswapV3FactoryMinimal.sol";
import {IUniswapV3PoolMinimal} from "../../src/v3/interfaces/uniswap/IUniswapV3PoolMinimal.sol";
import {MockGraduationManagerV3} from "./mocks/MockGraduationManagerV3.sol";

interface IERC20MetadataFork {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IWETH9Fork is IERC20MetadataFork {
    function deposit() external payable;
}

interface INonfungiblePositionManagerFork {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function factory() external view returns (address);
    function WETH9() external view returns (address);
    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

interface IUniswapV3PoolSwapFork {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

contract ForceEtherForkV3 {
    constructor() payable {}

    function force(address payable recipient) external {
        selfdestruct(recipient);
    }
}

/// @dev Minimal canonical-pool swap callback used only to create real LP fees
///      in ephemeral fork state. It has no production role.
contract ForkSwapPayerV3 {
    function swap(address pool, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96) external {
        IUniswapV3PoolSwapFork(pool).swap(address(this), zeroForOne, amountSpecified, sqrtPriceLimitX96, "");
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        if (amount0Delta > 0) {
            IERC20(IUniswapV3PoolMinimal(msg.sender).token0()).transfer(msg.sender, uint256(amount0Delta));
        }
        if (amount1Delta > 0) {
            IERC20(IUniswapV3PoolMinimal(msg.sender).token1()).transfer(msg.sender, uint256(amount1Delta));
        }
    }
}

/// @notice Pinned, read-only Base Sepolia fork validation of the canonical
/// Uniswap V3 launch-reservation boundary. All writes are ephemeral fork state.
contract BaseSepoliaUniswapV3ForkTest is Test {
    uint256 private constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 private constant PINNED_BLOCK = 45_436_872;
    uint24 private constant POOL_FEE = 10_000;
    int24 private constant TICK_SPACING = 200;
    uint256 private constant Q192 = 1 << 192;

    // Official Uniswap V3 Base Sepolia deployment addresses. These are
    // canonical public test fixtures, not protocol deployment configuration.
    address private constant UNISWAP_V3_FACTORY = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24;
    address private constant WETH = 0x4200000000000000000000000000000000000006;
    address private constant NONFUNGIBLE_POSITION_MANAGER = 0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2;

    address private constant CREATOR = address(0xC0FFEE);
    address private constant TREASURY = address(0x7007);
    address private constant ORDINARY_CALLER = address(0xB0B);
    address private constant BUYER = address(0xB0B0);
    address private constant THIRD_PARTY = address(0x7A1D);

    IUniswapV3FactoryMinimal private canonicalFactory;

    struct ConcreteSettlement {
        address token;
        address pool;
        address token0;
        address token1;
        uint256 poolTokenBefore;
        uint256 poolWethBefore;
        PermanentLPCustodianV3 custodian;
        PermanentResidualEscrowV3 residualEscrow;
    }

    function setUp() public {
        string memory rpcURL = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpcURL).length == 0) {
            vm.skip(true, "BASE_SEPOLIA_RPC_URL is not configured");
            return;
        }
        vm.createSelectFork(rpcURL, PINNED_BLOCK);
        assertEq(block.chainid, BASE_SEPOLIA_CHAIN_ID);
        canonicalFactory = IUniswapV3FactoryMinimal(UNISWAP_V3_FACTORY);
    }

    function testCanonicalFactoryWethAndProductionSelectors() public view {
        assertGt(UNISWAP_V3_FACTORY.code.length, 0);
        assertGt(WETH.code.length, 0);
        assertGt(NONFUNGIBLE_POSITION_MANAGER.code.length, 0);
        assertEq(canonicalFactory.feeAmountTickSpacing(POOL_FEE), TICK_SPACING);
        assertEq(canonicalFactory.feeAmountTickSpacing(12_345), 0);

        IERC20MetadataFork wrapped = IERC20MetadataFork(WETH);
        assertEq(wrapped.name(), "Wrapped Ether");
        assertEq(wrapped.symbol(), "WETH");
        assertEq(wrapped.decimals(), 18);
        assertEq(wrapped.balanceOf(address(this)), 0);

        INonfungiblePositionManagerFork positions = INonfungiblePositionManagerFork(NONFUNGIBLE_POSITION_MANAGER);
        assertEq(positions.factory(), UNISWAP_V3_FACTORY);
        assertEq(positions.WETH9(), WETH);

        address token = _counterfactualAddress("selector-token", true);
        assertEq(canonicalFactory.getPool(token, WETH, POOL_FEE), address(0));
        assertEq(canonicalFactory.getPool(WETH, token, POOL_FEE), address(0));
    }

    function testPermissionlessCanonicalPoolCreationAndInputRejections() public {
        address token = _counterfactualAddress("permissionless", true);
        vm.prank(ORDINARY_CALLER);
        address pool = canonicalFactory.createPool(token, WETH, POOL_FEE);

        assertEq(canonicalFactory.getPool(token, WETH, POOL_FEE), pool);
        assertEq(canonicalFactory.getPool(WETH, token, POOL_FEE), pool);
        _assertCanonicalPoolIdentity(pool, token);
        assertEq(IUniswapV3PoolMinimal(pool).liquidity(), 0);
        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        assertEq(sqrtPriceX96, 0);

        vm.expectRevert();
        canonicalFactory.createPool(token, WETH, POOL_FEE);
        vm.expectRevert();
        canonicalFactory.createPool(token, token, POOL_FEE);
        vm.expectRevert();
        canonicalFactory.createPool(address(0), WETH, POOL_FEE);
        vm.expectRevert();
        canonicalFactory.createPool(_counterfactualAddress("unsupported-fee", true), WETH, 12_345);
    }

    function testCounterfactualPoolCreationAndInitializationForBothOrderings() public {
        (uint160 tokenFirstPrice, uint160 wethFirstPrice) = _independentlyDerivedPrices();
        address tokenFirst = _counterfactualAddress("token-first", true);
        address wethFirst = _counterfactualAddress("weth-first", false);
        assertEq(tokenFirst.code.length, 0);
        assertEq(wethFirst.code.length, 0);

        address tokenFirstPool = canonicalFactory.createPool(tokenFirst, WETH, POOL_FEE);
        address wethFirstPool = canonicalFactory.createPool(wethFirst, WETH, POOL_FEE);
        _initializeAndAssertIrreversible(tokenFirstPool, tokenFirstPrice);
        _initializeAndAssertIrreversible(wethFirstPool, wethFirstPrice);
        assertEq(tokenFirst.code.length, 0);
        assertEq(wethFirst.code.length, 0);
    }

    function testStrictClassifierAcceptsOnlyNoPoolOrUninitialized() public {
        GraduationManagerV3 manager = new GraduationManagerV3(UNISWAP_V3_FACTORY, WETH);
        address noPool = _counterfactualAddress("state-none", true);
        (IGraduationManagerV3.PoolCandidateState state, address classifiedPool) = manager.classifyPoolCandidate(noPool);
        assertEq(uint256(state), uint256(IGraduationManagerV3.PoolCandidateState.NoPool));
        assertEq(classifiedPool, address(0));

        address uninitialized = _counterfactualAddress("state-uninitialized", true);
        address uninitializedPool = canonicalFactory.createPool(uninitialized, WETH, POOL_FEE);
        (state, classifiedPool) = manager.classifyPoolCandidate(uninitialized);
        assertEq(uint256(state), uint256(IGraduationManagerV3.PoolCandidateState.Uninitialized));
        assertEq(classifiedPool, uninitializedPool);

        address exact = _counterfactualAddress("state-exact", true);
        address exactPool = canonicalFactory.createPool(exact, WETH, POOL_FEE);
        IUniswapV3PoolMinimal(exactPool).initialize(manager.expectedSqrtPriceX96(exact));
        assertEq(IUniswapV3PoolMinimal(exactPool).liquidity(), 0);
        (state, classifiedPool) = manager.classifyPoolCandidate(exact);
        assertEq(uint256(state), uint256(IGraduationManagerV3.PoolCandidateState.InitializedExactPrice));
        assertEq(classifiedPool, exactPool);

        address wrong = _counterfactualAddress("state-wrong", true);
        address wrongPool = canonicalFactory.createPool(wrong, WETH, POOL_FEE);
        IUniswapV3PoolMinimal(wrongPool).initialize(manager.expectedSqrtPriceX96(wrong) + 1);
        (state, classifiedPool) = manager.classifyPoolCandidate(wrong);
        assertEq(uint256(state), uint256(IGraduationManagerV3.PoolCandidateState.IncorrectPrice));
        assertEq(classifiedPool, wrongPool);
    }

    function testConcreteGraduationSettlementCustodyFeesAndThirdPartyPosition() public {
        (
            ,
            GraduationManagerV3 manager,
            ZonkFactoryV3 factory,
            PermanentLPFeeVaultV3 vault,
            PermanentLPCustodianDeployerV3 deployer
        ) = _deployConcreteBoundStack();
        ConcreteSettlement memory settlement = _launchAndGraduateConcrete(manager, factory, deployer);
        _assertFeeRoutingAndThirdPartyIsolation(vault, settlement);
    }

    function _assertFeeRoutingAndThirdPartyIsolation(PermanentLPFeeVaultV3 vault, ConcreteSettlement memory settlement)
        private
    {
        uint256 thirdPartyId = _mintThirdPartyPosition(settlement.token, settlement.token0, settlement.token1);
        assertEq(INonfungiblePositionManagerV3(NONFUNGIBLE_POSITION_MANAGER).ownerOf(thirdPartyId), THIRD_PARTY);

        ForkSwapPayerV3 payer = new ForkSwapPayerV3();
        vm.deal(address(this), 1 ether);
        IWETH9Fork(WETH).deposit{value: 1 ether}();
        assertTrue(IERC20(WETH).transfer(address(payer), 1 ether));
        bool zeroForOne = settlement.token0 == WETH;
        payer.swap(settlement.pool, zeroForOne, 0.01 ether, zeroForOne ? 4_295_128_740 : type(uint160).max - 1);

        (uint256 collected0, uint256 collected1) = settlement.custodian.collectFees();
        assertTrue(collected0 != 0 || collected1 != 0);
        assertEq(vault.totalLPFeesAccrued(settlement.token0), collected0);
        assertEq(vault.totalLPFeesAccrued(settlement.token1), collected1);
        _assertDesignBLPFeeSplit(vault, settlement.token, settlement.token0, collected0);
        _assertDesignBLPFeeSplit(vault, settlement.token, settlement.token1, collected1);
        assertEq(INonfungiblePositionManagerV3(NONFUNGIBLE_POSITION_MANAGER).ownerOf(thirdPartyId), THIRD_PARTY);
    }

    function _assertDesignBLPFeeSplit(
        PermanentLPFeeVaultV3 vault,
        address launchToken,
        address asset,
        uint256 collected
    ) private view {
        uint256 creatorShare = collected * 25 / 100;
        uint256 communityShare = collected * 30 / 100;
        uint256 traderRewardsShare = collected * 15 / 100;
        uint256 protocolShare = collected - creatorShare - communityShare - traderRewardsShare;
        assertEq(vault.creatorLPFeesAccrued(CREATOR, asset), creatorShare);
        assertEq(vault.protocolLPFeesAccrued(TREASURY, asset), protocolShare);
        assertEq(vault.communityLPFeesAccrued(launchToken, asset), communityShare);
        assertEq(vault.traderRewardsLPFeesAccrued(launchToken, asset), traderRewardsShare);
        assertEq(creatorShare + protocolShare + communityShare + traderRewardsShare, collected);
        if (collected > 0) {
            assertGe(protocolShare, collected * 30 / 100);
        }
    }

    function testAtomicRegistrationCreatesAndRecordsCanonicalPool() public {
        (FeeManagerV3 fees, MockGraduationManagerV3 manager, ZonkFactoryV3 factory) = _deployBoundStack();
        fees;
        bytes32 salt = keccak256("fork-no-pool-launch");
        vm.prank(CREATOR);
        (address token, address curve) = factory.createToken("Fork Launch", "FLA", salt);

        address pool = canonicalFactory.getPool(token, WETH, POOL_FEE);
        assertTrue(pool != address(0));
        assertEq(manager.canonicalPoolOf(token), pool);
        _assertCanonicalPoolIdentity(pool, token);
        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        assertEq(sqrtPriceX96, manager.expectedSqrtPriceX96(token));
        (address registeredCurve, address registeredCreator, bool registered, bool graduated) = manager.launchOf(token);
        assertEq(registeredCurve, curve);
        assertEq(registeredCreator, CREATOR);
        assertTrue(registered);
        assertFalse(graduated);
        assertEq(factory.curveOf(token), curve);
        assertEq(ZonkCurveV3(payable(curve)).token(), token);
        assertEq(ZonkTokenV3(token).creator(), CREATOR);
    }

    function testAtomicRegistrationInitializesExistingCounterfactualPool() public {
        (, MockGraduationManagerV3 manager, ZonkFactoryV3 factory) = _deployBoundStack();
        bytes32 salt = keccak256("fork-existing-uninitialized");
        (address predicted,,) = _candidate(factory, CREATOR, "Existing Fork Pool", "EFP", salt, 0);
        address pool = canonicalFactory.createPool(predicted, WETH, POOL_FEE);
        (uint160 beforePrice,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        assertEq(beforePrice, 0);

        vm.prank(CREATOR);
        (address token,) = factory.createToken("Existing Fork Pool", "EFP", salt);
        assertEq(token, predicted);
        assertEq(manager.canonicalPoolOf(token), pool);
        (uint160 afterPrice,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        assertEq(afterPrice, manager.expectedSqrtPriceX96(token));
    }

    function testPreinitializedCandidateIsSkippedByCanonicalForkClassifier() public {
        (, MockGraduationManagerV3 manager, ZonkFactoryV3 factory) = _deployBoundStack();
        bytes32 salt = keccak256("fork-initialized-skip");
        (address first,,) = _candidate(factory, CREATOR, "Initialized Skip", "ISK", salt, 0);
        address occupiedPool = canonicalFactory.createPool(first, WETH, POOL_FEE);
        IUniswapV3PoolMinimal(occupiedPool).initialize(manager.expectedSqrtPriceX96(first));
        (address second,,) = _candidate(factory, CREATOR, "Initialized Skip", "ISK", salt, 1);

        vm.prank(CREATOR);
        (address token,) = factory.createToken("Initialized Skip", "ISK", salt);
        assertEq(token, second);
        assertNotEq(token, first);
        assertEq(first.code.length, 0);
        assertEq(manager.canonicalPoolOf(first), address(0));
    }

    function testRegistrationFailureRollsBackAllZonkAndCanonicalPoolState() public {
        (FeeManagerV3 fees, MockGraduationManagerV3 manager, ZonkFactoryV3 factory) = _deployBoundStack();
        manager.configureRegistrationFailure(true);
        bytes32 salt = keccak256("fork-registration-rollback");
        (address predicted,,) = _candidate(factory, CREATOR, "Fork Rollback", "FRB", salt, 0);
        bytes32 definition = keccak256(abi.encode(CREATOR, "Fork Rollback", "FRB"));
        address curveDeployer = factory.curveDeployer();
        uint64 curveDeployerNonce = vm.getNonce(curveDeployer);
        address predictedCurve = vm.computeCreateAddress(curveDeployer, curveDeployerNonce);

        vm.prank(CREATOR);
        vm.expectRevert(bytes("REGISTRATION_FAILED"));
        factory.createToken("Fork Rollback", "FRB", salt);

        assertEq(predicted.code.length, 0);
        assertEq(predictedCurve.code.length, 0);
        assertEq(vm.getNonce(curveDeployer), curveDeployerNonce);
        assertEq(canonicalFactory.getPool(predicted, WETH, POOL_FEE), address(0));
        assertEq(factory.definitionToken(definition), address(0));
        assertFalse(factory.isToken(predicted));
        assertEq(factory.curveOf(predicted), address(0));
        assertEq(fees.curveOf(predicted), address(0));
        assertEq(manager.canonicalPoolOf(predicted), address(0));
        (address curve, address creator, bool registered, bool graduated) = manager.launchOf(predicted);
        assertEq(curve, address(0));
        assertEq(creator, address(0));
        assertFalse(registered);
        assertFalse(graduated);
    }

    function testPreDeploymentLiquidityMintCapabilitiesAreSeparated() public {
        address counterfactualToken = _counterfactualAddress("position-token", true);
        assertEq(counterfactualToken.code.length, 0);
        address pool = canonicalFactory.createPool(counterfactualToken, WETH, POOL_FEE);
        (uint160 tokenFirstPrice,) = _independentlyDerivedPrices();
        IUniswapV3PoolMinimal(pool).initialize(tokenFirstPrice);
        (, int24 currentTick,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        int24 tickFloor = _floorToSpacing(currentTick);

        vm.deal(address(this), 3 ether);
        IWETH9Fork(WETH).deposit{value: 2 ether}();
        assertEq(IERC20MetadataFork(WETH).balanceOf(address(this)), 2 ether);
        assertTrue(IERC20MetadataFork(WETH).approve(NONFUNGIBLE_POSITION_MANAGER, type(uint256).max));

        INonfungiblePositionManagerFork positions = INonfungiblePositionManagerFork(NONFUNGIBLE_POSITION_MANAGER);
        INonfungiblePositionManagerFork.MintParams memory inRange = INonfungiblePositionManagerFork.MintParams({
            token0: counterfactualToken,
            token1: WETH,
            fee: POOL_FEE,
            tickLower: tickFloor,
            tickUpper: tickFloor + TICK_SPACING,
            amount0Desired: 1 ether,
            amount1Desired: 1 ether,
            amount0Min: 0,
            amount1Min: 0,
            recipient: address(this),
            deadline: block.timestamp
        });
        vm.expectRevert();
        positions.mint(inRange);

        INonfungiblePositionManagerFork.MintParams memory oneSided = INonfungiblePositionManagerFork.MintParams({
            token0: counterfactualToken,
            token1: WETH,
            fee: POOL_FEE,
            tickLower: tickFloor - (2 * TICK_SPACING),
            tickUpper: tickFloor - TICK_SPACING,
            amount0Desired: 0,
            amount1Desired: 1 ether,
            amount0Min: 0,
            amount1Min: 0,
            recipient: address(this),
            deadline: block.timestamp
        });
        (uint256 tokenId, uint128 positionLiquidity, uint256 amount0, uint256 amount1) = positions.mint(oneSided);
        assertGt(tokenId, 0);
        assertGt(positionLiquidity, 0);
        assertEq(amount0, 0);
        assertGt(amount1, 0);
        // The position exists, but it is out of range at the current tick, so
        // canonical pool.liquidity() still reports zero. This is why Zonk must
        // reject every pool initialized before its own reservation callback.
        assertEq(IUniswapV3PoolMinimal(pool).liquidity(), 0);
        assertEq(counterfactualToken.code.length, 0);
    }

    function _deployBoundStack()
        private
        returns (FeeManagerV3 fees, MockGraduationManagerV3 manager, ZonkFactoryV3 factory)
    {
        fees = new FeeManagerV3(address(this), TREASURY);
        manager = new MockGraduationManagerV3(UNISWAP_V3_FACTORY, WETH);
        factory = new ZonkFactoryV3(address(fees), address(manager));
        fees.setFactoryOnce(address(factory));
        manager.setFactoryOnce(address(factory));
    }

    function _deployConcreteBoundStack()
        private
        returns (
            FeeManagerV3 fees,
            GraduationManagerV3 manager,
            ZonkFactoryV3 factory,
            PermanentLPFeeVaultV3 vault,
            PermanentLPCustodianDeployerV3 deployer
        )
    {
        manager = new GraduationManagerV3(UNISWAP_V3_FACTORY, WETH);
        fees = new FeeManagerV3(address(this), TREASURY);
        factory = new ZonkFactoryV3(address(fees), address(manager));
        fees.setFactoryOnce(address(factory));
        manager.setFactoryOnce(address(factory));
        TokenCommunityVaultV3 community = new TokenCommunityVaultV3(address(this), TREASURY, address(fees));
        TraderRewardsVaultV3 rewards = new TraderRewardsVaultV3(address(this), address(fees));
        TraderRewardsDistributorV3 distributor = new TraderRewardsDistributorV3(address(this), address(rewards));
        rewards.setDistributorOnce(address(distributor));
        fees.bindEcosystemVaultsOnce(address(community), address(rewards));
        vault = new PermanentLPFeeVaultV3(address(manager), address(fees), address(community), address(rewards));
        community.setPermanentLPFeeVaultOnce(address(vault));
        rewards.setPermanentLPFeeVaultOnce(address(vault));
        deployer = new PermanentLPCustodianDeployerV3(address(manager), address(vault), NONFUNGIBLE_POSITION_MANAGER);
        manager.bindDependenciesOnce(address(vault), address(deployer), NONFUNGIBLE_POSITION_MANAGER);
    }

    function _launchAndGraduateConcrete(
        GraduationManagerV3 manager,
        ZonkFactoryV3 factory,
        PermanentLPCustodianDeployerV3 deployer
    ) private returns (ConcreteSettlement memory settlement) {
        address curveAddress;
        vm.prank(CREATOR);
        (settlement.token, curveAddress) =
            factory.createToken("Concrete Fork Launch", "CFL", keccak256("fork-concrete-graduation"));
        ZonkCurveV3 curve = ZonkCurveV3(payable(curveAddress));
        settlement.pool = manager.canonicalPoolOf(settlement.token);
        (settlement.token0, settlement.token1) =
            settlement.token < WETH ? (settlement.token, WETH) : (WETH, settlement.token);
        _assertCanonicalPoolIdentity(settlement.pool, settlement.token);
        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3PoolMinimal(settlement.pool).slot0();
        assertEq(sqrtPriceX96, manager.expectedSqrtPriceX96(settlement.token));

        ForceEtherForkV3 forced = new ForceEtherForkV3{value: 1 ether}();
        forced.force(payable(address(curve)));
        assertEq(curve.unaccountedEth(), 1 ether);
        ZonkCurveV3.BuyQuote memory quote = curve.quoteBuy(EndpointConstantsV3.EXACT_GRADUATION_GROSS);
        vm.deal(BUYER, quote.acceptedGross);
        settlement.poolTokenBefore = IERC20(settlement.token).balanceOf(settlement.pool);
        settlement.poolWethBefore = IERC20(WETH).balanceOf(settlement.pool);
        vm.prank(BUYER);
        curve.buy{value: quote.acceptedGross}(quote.tokensOut, block.timestamp + 1);

        settlement.custodian = PermanentLPCustodianV3(deployer.custodianOf(settlement.token));
        settlement.residualEscrow = PermanentResidualEscrowV3(manager.residualEscrowOf(settlement.token));
        uint256 tokenId = settlement.custodian.boundTokenId();
        assertTrue(manager.settled(settlement.token));
        assertTrue(settlement.custodian.positionRegistered());
        assertEq(
            INonfungiblePositionManagerV3(NONFUNGIBLE_POSITION_MANAGER).ownerOf(tokenId), address(settlement.custodian)
        );
        assertEq(settlement.custodian.EXPECTED_FEE(), POOL_FEE);
        assertEq(settlement.custodian.FULL_RANGE_TICK_LOWER(), -887_200);
        assertEq(settlement.custodian.FULL_RANGE_TICK_UPPER(), 887_200);
        uint256 expectedTokenUsed = 199_999_999_999_999_999_999_999_968;
        uint256 expectedWethUsed = 2_999_999_999_999_998_668;
        assertEq(IERC20(settlement.token).balanceOf(settlement.pool) - settlement.poolTokenBefore, expectedTokenUsed);
        assertEq(IERC20(WETH).balanceOf(settlement.pool) - settlement.poolWethBefore, expectedWethUsed);
        assertEq(settlement.residualEscrow.depositedResidual(settlement.token), 32);
        assertEq(settlement.residualEscrow.depositedResidual(WETH), 1_332);
        assertEq(IERC20(settlement.token).balanceOf(address(settlement.residualEscrow)), 32);
        assertEq(IERC20(WETH).balanceOf(address(settlement.residualEscrow)), 1_332);
        assertEq(IERC20(settlement.token).balanceOf(address(manager)), 0);
        assertEq(IERC20(WETH).balanceOf(address(manager)), 0);
        assertEq(IERC20(settlement.token).allowance(address(manager), NONFUNGIBLE_POSITION_MANAGER), 0);
        assertEq(IERC20(WETH).allowance(address(manager), NONFUNGIBLE_POSITION_MANAGER), 0);
        assertEq(curve.activeEthReserve(), 0);
        assertEq(curve.terminalGraduationReserve(), 3 ether);
        assertEq(curve.unaccountedEth(), 1 ether);
    }

    function _mintThirdPartyPosition(address token, address token0, address token1) private returns (uint256 tokenId) {
        uint256 tokenAmount = 1 ether;
        uint256 wethAmount = 15_000_000_000;
        vm.prank(BUYER);
        assertTrue(IERC20(token).transfer(address(this), tokenAmount));
        vm.deal(address(this), 1 ether);
        IWETH9Fork(WETH).deposit{value: wethAmount}();
        assertTrue(IERC20(token).approve(NONFUNGIBLE_POSITION_MANAGER, tokenAmount));
        assertTrue(IERC20(WETH).approve(NONFUNGIBLE_POSITION_MANAGER, wethAmount));
        INonfungiblePositionManagerV3.MintParams memory params;
        params.token0 = token0;
        params.token1 = token1;
        params.fee = POOL_FEE;
        params.tickLower = -887_200;
        params.tickUpper = 887_200;
        params.amount0Desired = token0 == token ? tokenAmount : wethAmount;
        params.amount1Desired = token0 == token ? wethAmount : tokenAmount;
        params.recipient = THIRD_PARTY;
        params.deadline = block.timestamp;
        (tokenId,,,) = INonfungiblePositionManagerV3(NONFUNGIBLE_POSITION_MANAGER).mint(params);
        IERC20(token).approve(NONFUNGIBLE_POSITION_MANAGER, 0);
        IERC20(WETH).approve(NONFUNGIBLE_POSITION_MANAGER, 0);
    }

    function _candidate(
        ZonkFactoryV3 factory,
        address creator,
        string memory name,
        string memory symbol,
        bytes32 userSalt,
        uint16 attemptIndex
    ) private view returns (address token, bytes32 launchSeed, bytes32 candidateSalt) {
        TokenDeployerV3 deployer = TokenDeployerV3(factory.tokenDeployer());
        launchSeed = deployer.computeLaunchSeed(creator, userSalt, name, symbol);
        candidateSalt = deployer.computeCandidateSalt(launchSeed, attemptIndex);
        token = deployer.computeTokenAddress(creator, name, symbol, candidateSalt);
    }

    function _assertCanonicalPoolIdentity(address pool, address token) private view {
        IUniswapV3PoolMinimal typedPool = IUniswapV3PoolMinimal(pool);
        assertEq(typedPool.factory(), UNISWAP_V3_FACTORY);
        assertEq(typedPool.token0(), token < WETH ? token : WETH);
        assertEq(typedPool.token1(), token < WETH ? WETH : token);
        assertEq(typedPool.fee(), POOL_FEE);
        assertEq(typedPool.tickSpacing(), TICK_SPACING);
    }

    function _initializeAndAssertIrreversible(address pool, uint160 expectedPrice) private {
        (uint160 beforePrice,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        assertEq(beforePrice, 0);
        IUniswapV3PoolMinimal(pool).initialize(expectedPrice);
        (uint160 afterPrice,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        assertEq(afterPrice, expectedPrice);
        vm.expectRevert();
        IUniswapV3PoolMinimal(pool).initialize(expectedPrice);
    }

    function _independentlyDerivedPrices() private pure returns (uint160 tokenFirst, uint160 wethFirst) {
        uint256 terminalPriceWeiPerToken = EndpointConstantsV3.TERMINAL_PRICE;
        uint256 tokenFirstRatioX192 = Math.mulDiv(terminalPriceWeiPerToken, Q192, 1 ether);
        uint256 wethFirstRatioX192 = Math.mulDiv(1 ether, Q192, terminalPriceWeiPerToken);
        tokenFirst = uint160(Math.sqrt(tokenFirstRatioX192));
        wethFirst = uint160(Math.sqrt(wethFirstRatioX192));
        assertEq(tokenFirst, 9_703_428_570_912_459_262_669_888);
        assertEq(wethFirst, 646_895_238_060_830_617_511_325_894_307_352);
        assertLe(uint256(tokenFirst) * tokenFirst, tokenFirstRatioX192);
        assertGt((uint256(tokenFirst) + 1) * (uint256(tokenFirst) + 1), tokenFirstRatioX192);
        assertLe(uint256(wethFirst) * wethFirst, wethFirstRatioX192);
        assertGt((uint256(wethFirst) + 1) * (uint256(wethFirst) + 1), wethFirstRatioX192);
    }

    function _counterfactualAddress(string memory label, bool belowWeth) private view returns (address candidate) {
        uint160 wethValue = uint160(WETH);
        uint160 entropy = uint160(uint256(keccak256(bytes(label))));
        if (belowWeth) {
            candidate = address(uint160(0x10_000 + (entropy % (wethValue - 0x10_000))));
        } else {
            candidate = address(uint160(wethValue + 1 + (entropy % (type(uint160).max - wethValue - 1))));
        }
        assertTrue(candidate != address(0) && candidate != WETH);
        assertEq(candidate.code.length, 0);
    }

    function _floorToSpacing(int24 tick) private pure returns (int24 floorTick) {
        int24 compressed = tick / TICK_SPACING;
        if (tick < 0 && tick % TICK_SPACING != 0) --compressed;
        floorTick = compressed * TICK_SPACING;
    }

    receive() external payable {}
}
