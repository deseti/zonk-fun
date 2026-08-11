// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ZonkCurve} from "../src/ZonkCurve.sol";
import {ZonkFactory} from "../src/ZonkFactory.sol";
import {ZonkToken} from "../src/ZonkToken.sol";
import {IZonkCurve} from "../src/interfaces/IZonkCurve.sol";
import {FeeManager} from "../src/fees/FeeManager.sol";
import {LiquidityManager} from "../src/liquidity/LiquidityManager.sol";
import {ILiquidityManager} from "../src/interfaces/ILiquidityManager.sol";
import {MockDEXAdapter} from "./mocks/MockDEXAdapter.sol";

contract CurveHandler {
    ZonkCurve internal immutable curve;
    ZonkToken internal immutable token;
    uint256 internal constant MAX_AMOUNT = 5 ether;
    uint256 public buyAttempts;
    uint256 public sellAttempts;
    uint256 public successfulBuys;
    uint256 public successfulSells;
    uint256 public graduationAttempts;
    uint256 public successfulGraduations;

    constructor(ZonkCurve curve_, ZonkToken token_) {
        curve = curve_;
        token = token_;
        token_.approve(address(curve_), type(uint256).max);
    }

    receive() external payable {}

    function buy(uint256 rawAmount) external {
        buyAttempts++;
        IZonkCurve.Curve memory state = curve.curve(address(token));
        if (state.lifecycle != IZonkCurve.Lifecycle.Active) return;
        uint256 remaining = state.graduationThreshold - state.soldSupply;
        uint256 maximum = remaining < MAX_AMOUNT ? remaining : MAX_AMOUNT;
        uint256 amount = rawAmount % maximum + 1;
        if (rawAmount % 16 == 0) amount = remaining;
        try curve.quoteBuy(address(token), amount) returns (uint256 reserveIn, uint256, uint256, uint256) {
            if (address(this).balance < reserveIn) return;
            try curve.buy{value: reserveIn}(address(token), amount, reserveIn) {
                successfulBuys++;
            } catch {}
        } catch {}
    }

    function sell(uint256 rawAmount) external {
        sellAttempts++;
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return;
        uint256 amount = rawAmount % balance + 1;
        if (amount > balance) amount = balance;
        try curve.quoteSell(address(token), amount) returns (uint256 reserveOut, uint256, uint256, uint256) {
            try curve.sell(address(token), amount, reserveOut) {
                successfulSells++;
            } catch {}
        } catch {}
    }

    function graduate() external {
        graduationAttempts++;
        try curve.graduate(address(token), block.timestamp + 1 hours) {
            successfulGraduations++;
        } catch {}
    }
}

contract ZonkCurveInvariantTest is Test {
    ZonkFactory internal factory;
    FeeManager internal feeManager;
    LiquidityManager internal liquidityManager;
    MockDEXAdapter internal adapter;
    ZonkCurve internal curve;
    ZonkToken internal token;
    CurveHandler internal handler;

    uint256 internal constant CURVE_SUPPLY = 100 ether;

    function setUp() public {
        factory = new ZonkFactory();
        feeManager = new FeeManager(address(this), makeAddr("treasury"), 100, 100);
        adapter = new MockDEXAdapter();
        liquidityManager = new LiquidityManager(address(this), address(this), 30 days, 500);
        liquidityManager.configureDexAdapter(address(adapter));
        curve = new ZonkCurve(address(factory), address(feeManager), address(liquidityManager));
        feeManager.grantRole(feeManager.CURVE_ROLE(), address(curve));
        liquidityManager.grantRole(liquidityManager.CURVE_ROLE(), address(curve));
        address creator = makeAddr("creator");
        vm.prank(creator);
        token = ZonkToken(factory.createToken("Zonk", "ZONK", 1_000 ether));
        vm.prank(creator);
        token.approve(address(curve), CURVE_SUPPLY);
        vm.prank(creator);
        curve.createCurve(address(token), CURVE_SUPPLY, 0.001 ether, 0.0001 ether, 90 ether);
        adapter.configureToken(address(token));

        handler = new CurveHandler(curve, token);
        liquidityManager.grantRole(liquidityManager.GRADUATION_EXECUTOR_ROLE(), address(handler));
        vm.deal(address(handler), 100 ether);
        targetContract(address(handler));
    }

    function invariant_reserveIsSolventAndSupplyMatchesState() public view {
        IZonkCurve.Curve memory state = curve.curve(address(token));
        assertLe(state.soldSupply, state.curveSupply);
        assertEq(address(feeManager).balance, feeManager.totalLiabilities());
        assertEq(
            feeManager.totalLiabilities(),
            feeManager.protocolFeesAccrued() + feeManager.creatorFeesAccrued(address(token))
        );

        if (state.lifecycle == IZonkCurve.Lifecycle.Active) {
            assertLt(state.soldSupply, state.graduationThreshold);
            assertEq(state.reserveBalance, address(curve).balance);
            assertEq(token.balanceOf(address(curve)) + state.soldSupply, state.curveSupply);
            assertFalse(liquidityManager.graduationExecuted(address(token)));
        } else if (state.lifecycle == IZonkCurve.Lifecycle.GraduationPending) {
            assertEq(state.soldSupply, state.graduationThreshold);
            assertEq(state.reserveBalance, address(curve).balance);
            assertEq(token.balanceOf(address(curve)) + state.soldSupply, state.curveSupply);
            assertFalse(liquidityManager.graduationExecuted(address(token)));
        } else {
            ILiquidityManager.GraduationRecord memory record = liquidityManager.graduation(address(token));
            assertEq(state.soldSupply, state.graduationThreshold);
            assertEq(state.reserveBalance, 0);
            assertEq(address(curve).balance, 0);
            assertEq(token.balanceOf(address(curve)), 0);
            assertTrue(liquidityManager.graduationExecuted(address(token)));
            assertEq(record.tokenAmount + state.soldSupply, state.curveSupply);
            assertEq(record.liquidityAmount, record.tokenAmount);
            assertEq(token.balanceOf(address(adapter)), record.tokenAmount);
            assertEq(address(adapter).balance, record.quoteAmount);
            assertEq(
                IERC20(record.liquidityToken).balanceOf(address(liquidityManager.lpLocker())), record.liquidityAmount
            );
        }
    }

    function testHandlerExercisesBuyAndSell() public {
        handler.buy(1);
        handler.sell(1);

        assertGt(handler.buyAttempts(), 0);
        assertGt(handler.sellAttempts(), 0);
        assertGt(handler.successfulBuys(), 0);
        assertGt(handler.successfulSells(), 0);
    }

    function testHandlerExercisesGraduation() public {
        handler.buy(16);
        handler.graduate();

        assertGt(handler.graduationAttempts(), 0);
        assertGt(handler.successfulGraduations(), 0);
    }
}
