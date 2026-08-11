// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IFeeManager} from "../src/interfaces/IFeeManager.sol";
import {IZonkCurve} from "../src/interfaces/IZonkCurve.sol";
import {FeeManager} from "../src/fees/FeeManager.sol";
import {ZonkCurve} from "../src/ZonkCurve.sol";
import {ZonkFactory} from "../src/ZonkFactory.sol";
import {ZonkToken} from "../src/ZonkToken.sol";
import {LiquidityManager} from "../src/liquidity/LiquidityManager.sol";
import {MockDEXAdapter} from "./mocks/MockDEXAdapter.sol";

contract FeeManagerTest is Test {
    event FeeConfigurationUpdated(
        uint16 previousProtocolFeeBps,
        uint16 previousCreatorFeeBps,
        uint16 newProtocolFeeBps,
        uint16 newCreatorFeeBps,
        address indexed configuredBy
    );
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury, address indexed configuredBy);
    event FeesAccrued(
        address indexed token,
        address indexed curve,
        address indexed creator,
        bool isBuy,
        uint256 protocolFee,
        uint256 creatorFee
    );
    event ProtocolFeesClaimed(address indexed treasury, uint256 amount);
    event CreatorFeesClaimed(address indexed token, address indexed creator, uint256 amount);

    ZonkFactory internal factory;
    FeeManager internal feeManager;
    LiquidityManager internal liquidityManager;
    ZonkCurve internal curve;
    ZonkToken internal token;

    address internal creator = makeAddr("fee-creator");
    address internal buyer = makeAddr("fee-buyer");
    address internal treasury = makeAddr("fee-treasury");
    address internal attacker = makeAddr("fee-attacker");

    uint256 internal constant CURVE_SUPPLY = 100 ether;
    uint256 internal constant STARTING_PRICE = 0.001 ether;
    uint256 internal constant SLOPE = 0.0001 ether;

    function setUp() public {
        factory = new ZonkFactory();
        feeManager = new FeeManager(address(this), treasury, 100, 100);
        MockDEXAdapter adapter = new MockDEXAdapter();
        liquidityManager = new LiquidityManager(address(this), address(this), 30 days, 500);
        liquidityManager.configureDexAdapter(address(adapter));
        curve = new ZonkCurve(address(factory), address(feeManager), address(liquidityManager));
        feeManager.grantRole(feeManager.CURVE_ROLE(), address(curve));
        liquidityManager.grantRole(liquidityManager.CURVE_ROLE(), address(curve));

        vm.prank(creator);
        token = ZonkToken(factory.createToken("Fee Zonk", "FZONK", 1_000 ether));
        vm.startPrank(creator);
        token.approve(address(curve), CURVE_SUPPLY);
        curve.createCurve(address(token), CURVE_SUPPLY, STARTING_PRICE, SLOPE, CURVE_SUPPLY - 1);
        vm.stopPrank();
        vm.deal(buyer, 100 ether);
    }

    function testConstructorAndCriticalAddressValidation() public {
        vm.expectRevert(IFeeManager.InvalidGovernance.selector);
        new FeeManager(address(0), treasury, 100, 100);

        vm.expectRevert(IFeeManager.InvalidTreasury.selector);
        new FeeManager(address(this), address(0), 100, 100);

        vm.expectRevert(IFeeManager.InvalidFeeConfiguration.selector);
        new FeeManager(address(this), treasury, 501, 100);

        vm.expectRevert(IFeeManager.InvalidFeeConfiguration.selector);
        new FeeManager(address(this), treasury, 100, 501);

        vm.expectRevert(IZonkCurve.InvalidFactory.selector);
        new ZonkCurve(address(0), address(feeManager), address(liquidityManager));
        vm.expectRevert(IZonkCurve.InvalidFactory.selector);
        new ZonkCurve(attacker, address(feeManager), address(liquidityManager));
        vm.expectRevert(IZonkCurve.InvalidFeeManager.selector);
        new ZonkCurve(address(factory), address(0), address(liquidityManager));
        vm.expectRevert(IZonkCurve.InvalidFeeManager.selector);
        new ZonkCurve(address(factory), attacker, address(liquidityManager));
        vm.expectRevert(IZonkCurve.InvalidLiquidityManager.selector);
        new ZonkCurve(address(factory), address(feeManager), address(0));
        vm.expectRevert(IZonkCurve.InvalidLiquidityManager.selector);
        new ZonkCurve(address(factory), address(feeManager), attacker);
    }

    function testFeeConfigurationAuthorizationCapsAndEvents() public {
        bytes32 feeConfigRole = feeManager.FEE_CONFIG_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, feeConfigRole)
        );
        feeManager.setFeeConfiguration(200, 200);

        vm.expectRevert(IFeeManager.InvalidFeeConfiguration.selector);
        feeManager.setFeeConfiguration(501, 0);
        vm.expectRevert(IFeeManager.InvalidFeeConfiguration.selector);
        feeManager.setFeeConfiguration(0, 501);

        vm.expectEmit(true, false, false, true, address(feeManager));
        emit FeeConfigurationUpdated(100, 100, 500, 500, address(this));
        feeManager.setFeeConfiguration(500, 500);
        assertEq(feeManager.protocolFeeBps(), 500);
        assertEq(feeManager.creatorFeeBps(), 500);
    }

    function testTreasuryConfigurationAuthorizationAndZeroAddress() public {
        address newTreasury = makeAddr("new-treasury");
        bytes32 feeConfigRole = feeManager.FEE_CONFIG_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, feeConfigRole)
        );
        feeManager.setTreasury(newTreasury);

        vm.expectRevert(IFeeManager.InvalidTreasury.selector);
        feeManager.setTreasury(address(0));

        vm.expectEmit(true, true, true, true, address(feeManager));
        emit TreasuryUpdated(treasury, newTreasury, address(this));
        feeManager.setTreasury(newTreasury);
        assertEq(feeManager.treasury(), newTreasury);
    }

    function testTokenRegistrationIsCurveAuthorizedAndImmutable() public {
        assertEq(feeManager.curveOf(address(token)), address(curve));
        assertEq(feeManager.creatorOf(address(token)), creator);

        bytes32 curveRole = feeManager.CURVE_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, curveRole)
        );
        feeManager.registerToken(address(token), attacker);

        vm.prank(address(curve));
        vm.expectRevert(IFeeManager.TokenAlreadyRegistered.selector);
        feeManager.registerToken(address(token), creator);

        feeManager.grantRole(feeManager.CURVE_ROLE(), address(this));
        vm.expectRevert(IFeeManager.InvalidToken.selector);
        feeManager.registerToken(address(0), creator);
        vm.expectRevert(IFeeManager.InvalidToken.selector);
        feeManager.registerToken(attacker, creator);

        vm.prank(creator);
        ZonkToken unregisteredToken = ZonkToken(factory.createToken("Unregistered", "UNREG", 1 ether));
        vm.expectRevert(IFeeManager.InvalidCreator.selector);
        feeManager.registerToken(address(unregisteredToken), address(0));
    }

    function testBuyAndSellAccrueExactlyOnceAndClaimsAreIsolated() public {
        uint256 amount = 10 ether;
        (uint256 reserveIn,, uint256 buyProtocolFee, uint256 buyCreatorFee) = curve.quoteBuy(address(token), amount);
        vm.prank(buyer);
        curve.buy{value: reserveIn}(address(token), amount, reserveIn);

        (uint256 reserveOut,, uint256 sellProtocolFee, uint256 sellCreatorFee) = curve.quoteSell(address(token), amount);
        vm.startPrank(buyer);
        token.approve(address(curve), amount);
        curve.sell(address(token), amount, reserveOut);
        vm.stopPrank();

        uint256 expectedProtocolFees = buyProtocolFee + sellProtocolFee;
        uint256 expectedCreatorFees = buyCreatorFee + sellCreatorFee;
        assertEq(feeManager.protocolFeesAccrued(), expectedProtocolFees);
        assertEq(feeManager.creatorFeesAccrued(address(token)), expectedCreatorFees);
        assertEq(feeManager.totalCreatorFeesAccrued(), expectedCreatorFees);
        assertEq(feeManager.totalLiabilities(), expectedProtocolFees + expectedCreatorFees);
        assertEq(address(feeManager).balance, feeManager.totalLiabilities());
        IZonkCurve.Curve memory stateBeforeClaims = curve.curve(address(token));
        uint256 reserveBeforeClaims = address(curve).balance;

        vm.prank(attacker);
        vm.expectRevert(IFeeManager.UnauthorizedCreator.selector);
        feeManager.claimCreatorFees(address(token));
        vm.prank(attacker);
        vm.expectRevert(IFeeManager.UnauthorizedTreasury.selector);
        feeManager.claimProtocolFees();

        uint256 creatorBefore = creator.balance;
        vm.prank(creator);
        assertEq(feeManager.claimCreatorFees(address(token)), expectedCreatorFees);
        assertEq(creator.balance - creatorBefore, expectedCreatorFees);

        uint256 treasuryBefore = treasury.balance;
        vm.prank(treasury);
        assertEq(feeManager.claimProtocolFees(), expectedProtocolFees);
        assertEq(treasury.balance - treasuryBefore, expectedProtocolFees);
        assertEq(feeManager.totalLiabilities(), 0);
        assertEq(address(feeManager).balance, 0);
        IZonkCurve.Curve memory stateAfterClaims = curve.curve(address(token));
        assertEq(stateAfterClaims.reserveBalance, stateBeforeClaims.reserveBalance);
        assertEq(address(curve).balance, reserveBeforeClaims);
    }

    function testRepeatedClaimsRevertWithoutChangingAccounting() public {
        _buy(1 ether);
        vm.prank(creator);
        feeManager.claimCreatorFees(address(token));
        vm.prank(treasury);
        feeManager.claimProtocolFees();

        vm.prank(creator);
        vm.expectRevert(IFeeManager.NothingToClaim.selector);
        feeManager.claimCreatorFees(address(token));
        vm.prank(treasury);
        vm.expectRevert(IFeeManager.NothingToClaim.selector);
        feeManager.claimProtocolFees();
        assertEq(feeManager.totalLiabilities(), 0);
    }

    function testAccrualAndClaimEventsMatchState() public {
        uint256 curveValue = 1 ether;
        (uint256 protocolFee, uint256 creatorFee) = feeManager.calculateBuyFees(curveValue);
        vm.deal(address(curve), protocolFee + creatorFee);

        vm.expectEmit(true, true, true, true, address(feeManager));
        emit FeesAccrued(address(token), address(curve), creator, true, protocolFee, creatorFee);
        vm.prank(address(curve));
        feeManager.accrueBuyFees{value: protocolFee + creatorFee}(address(token), curveValue);

        vm.expectEmit(true, true, false, true, address(feeManager));
        emit CreatorFeesClaimed(address(token), creator, creatorFee);
        vm.prank(creator);
        feeManager.claimCreatorFees(address(token));

        vm.expectEmit(true, false, false, true, address(feeManager));
        emit ProtocolFeesClaimed(treasury, protocolFee);
        vm.prank(treasury);
        feeManager.claimProtocolFees();
    }

    function testTreasuryChangeTransfersClaimAuthorityNotReserveAuthority() public {
        _buy(1 ether);
        uint256 accrued = feeManager.protocolFeesAccrued();
        address newTreasury = makeAddr("replacement-treasury");
        feeManager.setTreasury(newTreasury);

        vm.prank(treasury);
        vm.expectRevert(IFeeManager.UnauthorizedTreasury.selector);
        feeManager.claimProtocolFees();
        vm.prank(newTreasury);
        assertEq(feeManager.claimProtocolFees(), accrued);
    }

    function testFeeChangeImmediatelyAppliesToQuoteAndExecution() public {
        feeManager.setFeeConfiguration(250, 150);
        uint256 amount = 2 ether;
        (uint256 reserveIn, uint256 curveCost, uint256 protocolFee, uint256 creatorFee) =
            curve.quoteBuy(address(token), amount);
        (uint256 expectedProtocolFee, uint256 expectedCreatorFee) = feeManager.calculateBuyFees(curveCost);
        assertEq(protocolFee, expectedProtocolFee);
        assertEq(creatorFee, expectedCreatorFee);

        vm.prank(buyer);
        assertEq(curve.buy{value: reserveIn}(address(token), amount, reserveIn), reserveIn);
        assertEq(feeManager.protocolFeesAccrued(), expectedProtocolFee);
        assertEq(feeManager.creatorFeesAccrued(address(token)), expectedCreatorFee);
    }

    function testCreatorAccountingIsIsolatedPerToken() public {
        address secondCreator = makeAddr("second-creator");
        vm.prank(secondCreator);
        ZonkToken secondToken = ZonkToken(factory.createToken("Second Zonk", "SZONK", 1_000 ether));
        vm.startPrank(secondCreator);
        secondToken.approve(address(curve), CURVE_SUPPLY);
        curve.createCurve(address(secondToken), CURVE_SUPPLY, STARTING_PRICE, SLOPE, CURVE_SUPPLY - 1);
        vm.stopPrank();

        (uint256 firstReserveIn,,, uint256 firstCreatorFee) = curve.quoteBuy(address(token), 1 ether);
        (uint256 secondReserveIn,,, uint256 secondCreatorFee) = curve.quoteBuy(address(secondToken), 2 ether);
        vm.prank(buyer);
        curve.buy{value: firstReserveIn}(address(token), 1 ether, firstReserveIn);
        vm.prank(buyer);
        curve.buy{value: secondReserveIn}(address(secondToken), 2 ether, secondReserveIn);

        assertEq(feeManager.creatorOf(address(token)), creator);
        assertEq(feeManager.creatorOf(address(secondToken)), secondCreator);
        assertEq(feeManager.creatorFeesAccrued(address(token)), firstCreatorFee);
        assertEq(feeManager.creatorFeesAccrued(address(secondToken)), secondCreatorFee);

        vm.prank(creator);
        feeManager.claimCreatorFees(address(token));
        assertEq(feeManager.creatorFeesAccrued(address(token)), 0);
        assertEq(feeManager.creatorFeesAccrued(address(secondToken)), secondCreatorFee);
    }

    function testZeroFeesAndMaximumFeesAreValidBoundaries() public {
        feeManager.setFeeConfiguration(0, 0);
        (uint256 reserveIn, uint256 curveCost, uint256 protocolFee, uint256 creatorFee) =
            curve.quoteBuy(address(token), 1 ether);
        assertEq(reserveIn, curveCost);
        assertEq(protocolFee, 0);
        assertEq(creatorFee, 0);

        feeManager.setFeeConfiguration(500, 500);
        (, curveCost, protocolFee, creatorFee) = curve.quoteBuy(address(token), 1 ether);
        assertGt(curveCost, 0);
        assertGt(protocolFee, 0);
        assertGt(creatorFee, 0);
    }

    function testUnauthorizedAndIncorrectAccrualReverts() public {
        bytes32 curveRole = feeManager.CURVE_ROLE();
        address fakeToken = makeAddr("fake-token");
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, curveRole)
        );
        feeManager.registerToken(fakeToken, attacker);

        vm.prank(address(curve));
        vm.expectRevert(IFeeManager.InvalidAccrualValue.selector);
        feeManager.accrueBuyFees(address(token), 1 ether);
    }

    function testRevokedCurveCannotTradeOrAccrueFees() public {
        bytes32 curveRole = feeManager.CURVE_ROLE();
        feeManager.revokeRole(curveRole, address(curve));
        (uint256 reserveIn,,,) = curve.quoteBuy(address(token), 1 ether);

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(curve), curveRole)
        );
        curve.buy{value: reserveIn}(address(token), 1 ether, reserveIn);

        assertEq(token.balanceOf(buyer), 0);
        assertEq(feeManager.totalLiabilities(), 0);
        assertEq(curve.curve(address(token)).reserveBalance, 0);
    }

    function testFuzzFeeMathMatchesConfiguredRounding(
        uint128 rawCurveValue,
        uint16 rawProtocolBps,
        uint16 rawCreatorBps
    ) public {
        uint256 curveValue = bound(uint256(rawCurveValue), 1, 1e36);
        uint16 protocolBps = uint16(bound(uint256(rawProtocolBps), 0, 500));
        uint16 creatorBps = uint16(bound(uint256(rawCreatorBps), 0, 500));
        feeManager.setFeeConfiguration(protocolBps, creatorBps);

        (uint256 buyProtocolFee, uint256 buyCreatorFee) = feeManager.calculateBuyFees(curveValue);
        (uint256 sellProtocolFee, uint256 sellCreatorFee) = feeManager.calculateSellFees(curveValue);
        assertEq(buyProtocolFee, Math.mulDiv(curveValue, protocolBps, 10_000, Math.Rounding.Ceil));
        assertEq(buyCreatorFee, Math.mulDiv(curveValue, creatorBps, 10_000, Math.Rounding.Ceil));
        assertEq(sellProtocolFee, Math.mulDiv(curveValue, protocolBps, 10_000, Math.Rounding.Floor));
        assertEq(sellCreatorFee, Math.mulDiv(curveValue, creatorBps, 10_000, Math.Rounding.Floor));
        assertGe(buyProtocolFee, sellProtocolFee);
        assertGe(buyCreatorFee, sellCreatorFee);
    }

    function _buy(uint256 amount) private {
        (uint256 reserveIn,,,) = curve.quoteBuy(address(token), amount);
        vm.prank(buyer);
        curve.buy{value: reserveIn}(address(token), amount, reserveIn);
    }
}
