// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IZonkCurve} from "../src/interfaces/IZonkCurve.sol";
import {ZonkCurve} from "../src/ZonkCurve.sol";
import {ZonkFactory} from "../src/ZonkFactory.sol";
import {ZonkToken} from "../src/ZonkToken.sol";

contract ZonkCurveTest is Test {
    ZonkFactory internal factory;
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
        curve = new ZonkCurve(address(factory), protocol);

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
        assertFalse(state.graduated);
        assertEq(token.balanceOf(address(curve)), CURVE_SUPPLY);
    }

    function testQuoteBuyMatchesExecutionAndFeeAccounting() public {
        uint256 amount = 10 ether;
        (uint256 reserveIn, uint256 curveCost, uint256 protocolFee, uint256 creatorFee) =
            curve.quoteBuy(address(token), amount);
        uint256 protocolBefore = protocol.balance;
        uint256 creatorBefore = creator.balance;

        vm.prank(buyer);
        uint256 actualReserveIn = curve.buy{value: reserveIn}(address(token), amount, reserveIn);

        IZonkCurve.Curve memory state = curve.curve(address(token));
        assertEq(actualReserveIn, reserveIn);
        assertEq(token.balanceOf(buyer), amount);
        assertEq(state.soldSupply, amount);
        assertEq(state.reserveBalance, curveCost);
        assertEq(address(curve).balance, curveCost);
        assertEq(protocol.balance - protocolBefore, protocolFee);
        assertEq(creator.balance - creatorBefore, creatorFee);
    }

    function testLinearFormulaAndRounding() public {
        ZonkCurve formulaCurve = new ZonkCurve(address(factory), protocol);
        vm.prank(creator);
        token.approve(address(formulaCurve), 20 ether);
        vm.prank(creator);
        formulaCurve.createCurve(address(token), 20 ether, 1 ether, 1 ether, 20 ether);

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
        uint256 protocolBefore = protocol.balance;
        uint256 creatorBefore = creator.balance;

        vm.startPrank(buyer);
        IERC20(address(token)).approve(address(curve), amount);
        uint256 actualReserveOut = curve.sell(address(token), amount, reserveOut);
        vm.stopPrank();

        IZonkCurve.Curve memory state = curve.curve(address(token));
        assertEq(actualReserveOut, reserveOut);
        assertEq(buyer.balance - buyerBefore, reserveOut);
        assertEq(protocol.balance - protocolBefore, protocolFee);
        assertEq(creator.balance - creatorBefore, creatorFee);
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

        ZonkCurve anotherCurve = new ZonkCurve(address(factory), protocol);
        vm.prank(creator);
        vm.expectRevert(IZonkCurve.InvalidCurveParameters.selector);
        anotherCurve.createCurve(address(token), 0, STARTING_PRICE, SLOPE, 1 ether);
    }

    function testCurveParameterBounds() public {
        ZonkToken maxPriceToken = _newToken("MaxPrice");
        ZonkCurve maxPriceCurve = new ZonkCurve(address(factory), protocol);
        _seed(maxPriceToken, maxPriceCurve, 10 ether);
        uint256 maxStartingPrice = maxPriceCurve.MAX_STARTING_PRICE();
        vm.prank(creator);
        maxPriceCurve.createCurve(address(maxPriceToken), 10 ether, maxStartingPrice, SLOPE, 10 ether);

        ZonkToken maxSlopeToken = _newToken("MaxSlope");
        ZonkCurve maxSlopeCurve = new ZonkCurve(address(factory), protocol);
        _seed(maxSlopeToken, maxSlopeCurve, 10 ether);
        uint256 maxSlope = maxSlopeCurve.MAX_SLOPE();
        vm.prank(creator);
        maxSlopeCurve.createCurve(address(maxSlopeToken), 10 ether, STARTING_PRICE, maxSlope, 10 ether);

        ZonkToken zeroPriceToken = _newToken("ZeroPrice");
        ZonkCurve zeroPriceCurve = new ZonkCurve(address(factory), protocol);
        _seed(zeroPriceToken, zeroPriceCurve, 10 ether);
        vm.prank(creator);
        vm.expectRevert(IZonkCurve.InvalidCurveParameters.selector);
        zeroPriceCurve.createCurve(address(zeroPriceToken), 10 ether, 0, SLOPE, 10 ether);

        ZonkToken zeroSlopeToken = _newToken("ZeroSlope");
        ZonkCurve zeroSlopeCurve = new ZonkCurve(address(factory), protocol);
        _seed(zeroSlopeToken, zeroSlopeCurve, 10 ether);
        vm.prank(creator);
        vm.expectRevert(IZonkCurve.InvalidCurveParameters.selector);
        zeroSlopeCurve.createCurve(address(zeroSlopeToken), 10 ether, STARTING_PRICE, 0, 10 ether);

        ZonkToken abovePriceToken = _newToken("AbovePrice");
        ZonkCurve abovePriceCurve = new ZonkCurve(address(factory), protocol);
        _seed(abovePriceToken, abovePriceCurve, 10 ether);
        uint256 abovePrice = abovePriceCurve.MAX_STARTING_PRICE();
        vm.prank(creator);
        vm.expectRevert(IZonkCurve.InvalidCurveParameters.selector);
        abovePriceCurve.createCurve(address(abovePriceToken), 10 ether, abovePrice + 1, SLOPE, 10 ether);

        ZonkToken aboveSlopeToken = _newToken("AboveSlope");
        ZonkCurve aboveSlopeCurve = new ZonkCurve(address(factory), protocol);
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
        ZonkCurve extremeCurve = new ZonkCurve(address(factory), protocol);
        _seed(extremeToken, extremeCurve, supply);
        uint256 maxStartingPrice = extremeCurve.MAX_STARTING_PRICE();
        uint256 maxSlope = extremeCurve.MAX_SLOPE();
        vm.prank(creator);
        extremeCurve.createCurve(address(extremeToken), supply, maxStartingPrice, maxSlope, supply);

        (uint256 maximumReserveIn, uint256 maximumCurveCost,,) = extremeCurve.quoteBuy(address(extremeToken), supply);
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
        ZonkCurve graduationCurve = new ZonkCurve(address(factory), protocol);
        vm.prank(creator);
        token.approve(address(graduationCurve), CURVE_SUPPLY);
        vm.prank(creator);
        graduationCurve.createCurve(address(token), CURVE_SUPPLY, STARTING_PRICE, SLOPE, 1 ether);

        (uint256 reserveIn,,,) = graduationCurve.quoteBuy(address(token), 1 ether);
        vm.prank(buyer);
        graduationCurve.buy{value: reserveIn}(address(token), 1 ether, reserveIn);

        IZonkCurve.Curve memory state = graduationCurve.curve(address(token));
        assertEq(state.soldSupply, state.graduationThreshold);
        assertTrue(state.graduated);

        vm.expectRevert(IZonkCurve.AlreadyGraduated.selector);
        graduationCurve.quoteBuy(address(token), 1);
        vm.expectRevert(IZonkCurve.AlreadyGraduated.selector);
        graduationCurve.quoteSell(address(token), 1);
    }

    function testFeeRoundingDoesNotOverdrawSmallSell() public {
        ZonkCurve tinyCurve = new ZonkCurve(address(factory), protocol);
        vm.prank(creator);
        token.approve(address(tinyCurve), CURVE_SUPPLY);
        vm.prank(creator);
        tinyCurve.createCurve(address(token), CURVE_SUPPLY, 1 ether, 1 ether, CURVE_SUPPLY);

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
}
