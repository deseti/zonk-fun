// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IZonkCurve} from "../src/interfaces/IZonkCurve.sol";
import {ZonkCurve} from "../src/ZonkCurve.sol";
import {ZonkFactory} from "../src/ZonkFactory.sol";
import {ZonkToken} from "../src/ZonkToken.sol";
import {FeeManager} from "../src/fees/FeeManager.sol";
import {LiquidityManager} from "../src/liquidity/LiquidityManager.sol";
import {MockDEXAdapter} from "./mocks/MockDEXAdapter.sol";

contract ZonkCurveTest is Test {
    ZonkFactory internal factory;
    FeeManager internal feeManager;
    LiquidityManager internal liquidityManager;
    MockDEXAdapter internal dexAdapter;
    ZonkCurve internal curve;
    ZonkToken internal token;
    address internal creator = makeAddr("creator");
    address internal buyer = makeAddr("buyer");
    address internal protocol = makeAddr("protocol");

    uint256 internal constant INITIAL_SUPPLY = 1_000 ether;
    uint256 internal constant CURVE_SUPPLY = 100 ether;
    uint256 internal constant STARTING_PRICE = 0.001 ether;
    uint256 internal constant SLOPE = 0.0001 ether;
    uint256 internal constant GRADUATION = 90 ether;

    function setUp() public {
        factory = new ZonkFactory();
        feeManager = new FeeManager(address(this), protocol, 100, 100);
        dexAdapter = new MockDEXAdapter();
        liquidityManager = new LiquidityManager(address(this), address(this), 30 days, 500);
        liquidityManager.configureDexAdapter(address(dexAdapter));
        curve = new ZonkCurve(address(factory), address(feeManager), address(liquidityManager));
        feeManager.grantRole(feeManager.CURVE_ROLE(), address(curve));
        liquidityManager.grantRole(liquidityManager.CURVE_ROLE(), address(curve));

        vm.prank(creator);
        token = ZonkToken(factory.createToken("Zonk", "ZONK", INITIAL_SUPPLY));
        vm.prank(creator);
        token.approve(address(curve), CURVE_SUPPLY);
        vm.prank(creator);
        curve.createCurve(address(token), CURVE_SUPPLY, STARTING_PRICE, SLOPE, GRADUATION);

        vm.deal(buyer, 100 ether);
    }

    function testCreateCurveEscrowsSupplyAndStoresParameters() public view {
        IZonkCurve.Curve memory state = curve.curve(address(token));

        assertEq(state.token, address(token));
        assertEq(state.creator, creator);
        assertEq(state.curveSupply, CURVE_SUPPLY);
        assertEq(state.soldSupply, 0);
        assertEq(state.reserveBalance, 0);
        assertEq(state.startingPrice, STARTING_PRICE);
        assertEq(state.slope, SLOPE);
        assertEq(state.graduationThreshold, GRADUATION);
        assertEq(uint256(state.lifecycle), uint256(IZonkCurve.Lifecycle.Active));
        assertEq(token.balanceOf(address(curve)), CURVE_SUPPLY);
    }

    function testQuoteBuyMatchesExecutionAndFeeAccounting() public {
        uint256 amount = 10 ether;
        (uint256 reserveIn, uint256 curveCost, uint256 protocolFee, uint256 creatorFee) =
            curve.quoteBuy(address(token), amount);
        vm.prank(buyer);
        uint256 actualReserveIn = curve.buy{value: reserveIn}(address(token), amount, reserveIn);

        IZonkCurve.Curve memory state = curve.curve(address(token));
        assertEq(actualReserveIn, reserveIn);
        assertEq(token.balanceOf(buyer), amount);
        assertEq(state.soldSupply, amount);
        assertEq(state.reserveBalance, curveCost);
        assertEq(address(curve).balance, curveCost);
        assertEq(feeManager.protocolFeesAccrued(), protocolFee);
        assertEq(feeManager.creatorFeesAccrued(address(token)), creatorFee);
        assertEq(address(feeManager).balance, protocolFee + creatorFee);
        assertEq(feeManager.totalLiabilities(), address(feeManager).balance);
    }

    function testLinearFormulaAndRounding() public {
        ZonkCurve formulaCurve = _newCurve();
        vm.prank(creator);
        token.approve(address(formulaCurve), 20 ether);
        vm.prank(creator);
        formulaCurve.createCurve(address(token), 20 ether, 1 ether, 1 ether, 20 ether - 1);

        (uint256 reserveIn, uint256 curveCost,,) = formulaCurve.quoteBuy(address(token), 1 ether);
        // At q = 0 and d = 1 token, integral(P) = 1 + 1/2 ETH = 1.5 ETH.
        assertEq(curveCost, 1.5 ether);

        vm.prank(buyer);
        formulaCurve.buy{value: reserveIn}(address(token), 1 ether, reserveIn);
        (, uint256 curveValue,,) = formulaCurve.quoteSell(address(token), 1 ether);
        assertEq(curveValue, 1.5 ether);
    }

    function testQuoteSellMatchesExecutionAndReserveAccounting() public {
        uint256 amount = 10 ether;
        (uint256 buyCost, uint256 buyCurveCost,,) = curve.quoteBuy(address(token), amount);
        vm.prank(buyer);
        curve.buy{value: buyCost}(address(token), amount, buyCost);

        (uint256 reserveOut, uint256 curveValue, uint256 protocolFee, uint256 creatorFee) =
            curve.quoteSell(address(token), amount);
        uint256 buyerBefore = buyer.balance;
        uint256 protocolBefore = feeManager.protocolFeesAccrued();
        uint256 creatorBefore = feeManager.creatorFeesAccrued(address(token));

        vm.startPrank(buyer);
        IERC20(address(token)).approve(address(curve), amount);
        uint256 actualReserveOut = curve.sell(address(token), amount, reserveOut);
        vm.stopPrank();

        IZonkCurve.Curve memory state = curve.curve(address(token));
        assertEq(actualReserveOut, reserveOut);
        assertEq(buyer.balance - buyerBefore, reserveOut);
        assertEq(feeManager.protocolFeesAccrued() - protocolBefore, protocolFee);
        assertEq(feeManager.creatorFeesAccrued(address(token)) - creatorBefore, creatorFee);
        assertEq(state.soldSupply, 0);
        assertEq(state.reserveBalance + curveValue, buyCurveCost);
        assertEq(address(curve).balance, state.reserveBalance);
        assertEq(token.balanceOf(address(curve)), CURVE_SUPPLY);
    }

    function testBuyRefundsExcessAndHonorsMaximum() public {
        uint256 amount = 1 ether;
        (uint256 reserveIn,,,) = curve.quoteBuy(address(token), amount);
        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        curve.buy{value: reserveIn + 1 ether}(address(token), amount, reserveIn);

        assertEq(buyerBefore - buyer.balance, reserveIn);
    }

    function testBuyAndSellSlippageProtection() public {
        uint256 amount = 1 ether;
        (uint256 reserveIn,,,) = curve.quoteBuy(address(token), amount);

        vm.prank(buyer);
        vm.expectRevert(IZonkCurve.SlippageExceeded.selector);
        curve.buy{value: reserveIn}(address(token), amount, reserveIn - 1);

        vm.prank(buyer);
        curve.buy{value: reserveIn}(address(token), amount, reserveIn);
        vm.startPrank(buyer);
        token.approve(address(curve), amount);
        (uint256 reserveOut,,,) = curve.quoteSell(address(token), amount);
        vm.expectRevert(IZonkCurve.SlippageExceeded.selector);
        curve.sell(address(token), amount, reserveOut + 1);
        vm.stopPrank();
    }

    function testInvalidAmountsAndReserveProtection() public {
        vm.expectRevert(IZonkCurve.InvalidAmount.selector);
        curve.quoteBuy(address(token), 0);

        vm.expectRevert(IZonkCurve.InvalidAmount.selector);
        curve.quoteSell(address(token), 1);

        vm.prank(buyer);
        vm.expectRevert(IZonkCurve.InsufficientMsgValue.selector);
        curve.buy{value: 1}(address(token), 1 ether, type(uint256).max);

        vm.prank(buyer);
        vm.expectRevert(IZonkCurve.InsufficientCurveInventory.selector);
        curve.quoteBuy(address(token), CURVE_SUPPLY + 1);
    }

    function testCurveCreationValidationAndAuthorization() public {
        vm.prank(buyer);
        vm.expectRevert(IZonkCurve.OnlyTokenCreator.selector);
        curve.createCurve(address(token), 1 ether, STARTING_PRICE, SLOPE, 1 ether);

        vm.prank(creator);
        vm.expectRevert(IZonkCurve.CurveAlreadyExists.selector);
        curve.createCurve(address(token), 1 ether, STARTING_PRICE, SLOPE, 1 ether);

        ZonkCurve anotherCurve = _newCurve();
        vm.prank(creator);
        vm.expectRevert(IZonkCurve.InvalidCurveParameters.selector);
        anotherCurve.createCurve(address(token), 0, STARTING_PRICE, SLOPE, 1 ether);
    }

    function testCurveParameterBounds() public {
        ZonkToken maxPriceToken = _newToken("MaxPrice");
        ZonkCurve maxPriceCurve = _newCurve();
        _seed(maxPriceToken, maxPriceCurve, 10 ether);
        uint256 maxStartingPrice = maxPriceCurve.MAX_STARTING_PRICE();
        vm.prank(creator);
        maxPriceCurve.createCurve(address(maxPriceToken), 10 ether, maxStartingPrice, SLOPE, 10 ether - 1);

        ZonkToken maxSlopeToken = _newToken("MaxSlope");
        ZonkCurve maxSlopeCurve = _newCurve();
        _seed(maxSlopeToken, maxSlopeCurve, 10 ether);
        uint256 maxSlope = maxSlopeCurve.MAX_SLOPE();
        vm.prank(creator);
        maxSlopeCurve.createCurve(address(maxSlopeToken), 10 ether, STARTING_PRICE, maxSlope, 10 ether - 1);

        ZonkToken zeroPriceToken = _newToken("ZeroPrice");
        ZonkCurve zeroPriceCurve = _newCurve();
        _seed(zeroPriceToken, zeroPriceCurve, 10 ether);
        vm.prank(creator);
        vm.expectRevert(IZonkCurve.InvalidCurveParameters.selector);
        zeroPriceCurve.createCurve(address(zeroPriceToken), 10 ether, 0, SLOPE, 10 ether);

        ZonkToken zeroSlopeToken = _newToken("ZeroSlope");
        ZonkCurve zeroSlopeCurve = _newCurve();
        _seed(zeroSlopeToken, zeroSlopeCurve, 10 ether);
        vm.prank(creator);
        vm.expectRevert(IZonkCurve.InvalidCurveParameters.selector);
        zeroSlopeCurve.createCurve(address(zeroSlopeToken), 10 ether, STARTING_PRICE, 0, 10 ether);

        ZonkToken abovePriceToken = _newToken("AbovePrice");
        ZonkCurve abovePriceCurve = _newCurve();
        _seed(abovePriceToken, abovePriceCurve, 10 ether);
        uint256 abovePrice = abovePriceCurve.MAX_STARTING_PRICE();
        vm.prank(creator);
        vm.expectRevert(IZonkCurve.InvalidCurveParameters.selector);
        abovePriceCurve.createCurve(address(abovePriceToken), 10 ether, abovePrice + 1, SLOPE, 10 ether);

        ZonkToken aboveSlopeToken = _newToken("AboveSlope");
        ZonkCurve aboveSlopeCurve = _newCurve();
        _seed(aboveSlopeToken, aboveSlopeCurve, 10 ether);
        uint256 aboveSlope = aboveSlopeCurve.MAX_SLOPE();
        vm.prank(creator);
        vm.expectRevert(IZonkCurve.InvalidCurveParameters.selector);
        aboveSlopeCurve.createCurve(address(aboveSlopeToken), 10 ether, STARTING_PRICE, aboveSlope + 1, 10 ether);
    }

    function testExtremeValidQuotesAndExecutionConsistency() public {
        uint256 supply = 1_000_000_000 ether;
        ZonkToken extremeToken;
        vm.prank(creator);
        extremeToken = ZonkToken(factory.createToken("Extreme", "EXT", supply));
        ZonkCurve extremeCurve = _newCurve();
        _seed(extremeToken, extremeCurve, supply);
        uint256 maxStartingPrice = extremeCurve.MAX_STARTING_PRICE();
        uint256 maxSlope = extremeCurve.MAX_SLOPE();
        vm.prank(creator);
        extremeCurve.createCurve(address(extremeToken), supply, maxStartingPrice, maxSlope, supply - 1);

        (uint256 maximumReserveIn, uint256 maximumCurveCost,,) =
            extremeCurve.quoteBuy(address(extremeToken), supply - 1);
        assertGt(maximumReserveIn, maximumCurveCost);
        assertGt(maximumCurveCost, 0);

        uint256 amount = 1 ether;
        (uint256 reserveIn,,,) = extremeCurve.quoteBuy(address(extremeToken), amount);
        vm.deal(buyer, reserveIn);
        vm.prank(buyer);
        uint256 actualReserveIn = extremeCurve.buy{value: reserveIn}(address(extremeToken), amount, reserveIn);
        assertEq(actualReserveIn, reserveIn);

        (uint256 reserveOut,,,) = extremeCurve.quoteSell(address(extremeToken), amount);
        vm.startPrank(buyer);
        extremeToken.approve(address(extremeCurve), amount);
        uint256 actualReserveOut = extremeCurve.sell(address(extremeToken), amount, reserveOut);
        vm.stopPrank();
        assertEq(actualReserveOut, reserveOut);
    }

    function testGraduationStopsFurtherTrading() public {
        dexAdapter.configureToken(address(token));
        (uint256 reserveIn,,,) = curve.quoteBuy(address(token), GRADUATION);
        vm.prank(buyer);
        curve.buy{value: reserveIn}(address(token), GRADUATION, reserveIn);

        IZonkCurve.Curve memory state = curve.curve(address(token));
        assertEq(state.soldSupply, state.graduationThreshold);
        assertEq(uint256(state.lifecycle), uint256(IZonkCurve.Lifecycle.GraduationPending));

        vm.expectRevert(abi.encodeWithSelector(IZonkCurve.TradingNotActive.selector, state.lifecycle));
        curve.quoteBuy(address(token), 1);
        vm.expectRevert(abi.encodeWithSelector(IZonkCurve.TradingNotActive.selector, state.lifecycle));
        curve.quoteSell(address(token), 1);

        vm.prank(creator);
        curve.graduate(address(token), block.timestamp + 1 hours);
        state = curve.curve(address(token));
        assertEq(uint256(state.lifecycle), uint256(IZonkCurve.Lifecycle.Graduated));
        assertEq(state.reserveBalance, 0);
    }

    function testFeeRoundingDoesNotOverdrawSmallSell() public {
        ZonkCurve tinyCurve = _newCurve();
        vm.prank(creator);
        token.approve(address(tinyCurve), CURVE_SUPPLY);
        vm.prank(creator);
        tinyCurve.createCurve(address(token), CURVE_SUPPLY, 1 ether, 1 ether, CURVE_SUPPLY - 1);

        (uint256 reserveIn,,,) = tinyCurve.quoteBuy(address(token), 1);
        vm.prank(buyer);
        tinyCurve.buy{value: reserveIn}(address(token), 1, reserveIn);
        (uint256 reserveOut, uint256 curveValue, uint256 protocolFee, uint256 creatorFee) =
            tinyCurve.quoteSell(address(token), 1);

        assertLe(protocolFee + creatorFee, curveValue);
        assertGt(reserveOut, 0);
    }

    function testFuzz_BuyAndSell(uint96 rawAmount) public {
        uint256 amount = bound(uint256(rawAmount), 1, 20 ether);
        (uint256 reserveIn,,,) = curve.quoteBuy(address(token), amount);
        vm.prank(buyer);
        curve.buy{value: reserveIn}(address(token), amount, reserveIn);

        (uint256 reserveOut,,,) = curve.quoteSell(address(token), amount);
        vm.startPrank(buyer);
        token.approve(address(curve), amount);
        curve.sell(address(token), amount, reserveOut);
        vm.stopPrank();

        IZonkCurve.Curve memory state = curve.curve(address(token));
        assertEq(state.soldSupply, 0);
        assertLe(state.reserveBalance, address(curve).balance);
        assertEq(token.balanceOf(address(curve)), CURVE_SUPPLY);
    }

    function testRepeatedBuySellOperationsPreserveAccounting() public {
        for (uint256 i = 1; i <= 5; ++i) {
            uint256 amount = i * 1 ether;
            (uint256 reserveIn,,,) = curve.quoteBuy(address(token), amount);
            vm.prank(buyer);
            curve.buy{value: reserveIn}(address(token), amount, reserveIn);

            (uint256 reserveOut,,,) = curve.quoteSell(address(token), amount);
            vm.startPrank(buyer);
            token.approve(address(curve), amount);
            curve.sell(address(token), amount, reserveOut);
            vm.stopPrank();
        }

        IZonkCurve.Curve memory state = curve.curve(address(token));
        assertEq(state.soldSupply, 0);
        assertEq(token.balanceOf(address(curve)), CURVE_SUPPLY);
        assertEq(address(curve).balance, state.reserveBalance);
    }

    function _newToken(string memory name) private returns (ZonkToken createdToken) {
        vm.prank(creator);
        createdToken = ZonkToken(factory.createToken(name, name, INITIAL_SUPPLY));
    }

    function _seed(ZonkToken seedToken, ZonkCurve seedCurve, uint256 amount) private {
        vm.prank(creator);
        seedToken.approve(address(seedCurve), amount);
    }

    function _newCurve() private returns (ZonkCurve createdCurve) {
        FeeManager createdFeeManager = new FeeManager(address(this), protocol, 100, 100);
        MockDEXAdapter createdAdapter = new MockDEXAdapter();
        LiquidityManager createdLiquidityManager = new LiquidityManager(address(this), address(this), 30 days, 500);
        createdLiquidityManager.configureDexAdapter(address(createdAdapter));
        createdCurve = new ZonkCurve(address(factory), address(createdFeeManager), address(createdLiquidityManager));
        createdFeeManager.grantRole(createdFeeManager.CURVE_ROLE(), address(createdCurve));
        createdLiquidityManager.grantRole(createdLiquidityManager.CURVE_ROLE(), address(createdCurve));
    }
}
