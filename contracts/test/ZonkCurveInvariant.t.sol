// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ZonkCurve} from "../src/ZonkCurve.sol";
import {ZonkFactory} from "../src/ZonkFactory.sol";
import {ZonkToken} from "../src/ZonkToken.sol";
import {IZonkCurve} from "../src/interfaces/IZonkCurve.sol";

contract CurveHandler {
    ZonkCurve internal immutable curve;
    ZonkToken internal immutable token;
    uint256 internal constant MAX_AMOUNT = 5 ether;
    uint256 public buyAttempts;
    uint256 public sellAttempts;
    uint256 public successfulBuys;
    uint256 public successfulSells;

    constructor(ZonkCurve curve_, ZonkToken token_) {
        curve = curve_;
        token = token_;
        token_.approve(address(curve_), type(uint256).max);
    }

    receive() external payable {}

    function buy(uint256 rawAmount) external {
        buyAttempts++;
        uint256 amount = rawAmount % MAX_AMOUNT + 1;
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
}

contract ZonkCurveInvariantTest is Test {
    ZonkFactory internal factory;
    ZonkCurve internal curve;
    ZonkToken internal token;
    CurveHandler internal handler;

    uint256 internal constant CURVE_SUPPLY = 100 ether;

    function setUp() public {
        factory = new ZonkFactory();
        curve = new ZonkCurve(address(factory), makeAddr("protocol"));
        address creator = makeAddr("creator");
        vm.prank(creator);
        token = ZonkToken(factory.createToken("Zonk", "ZONK", 1_000 ether));
        vm.prank(creator);
        token.approve(address(curve), CURVE_SUPPLY);
        vm.prank(creator);
        curve.createCurve(address(token), CURVE_SUPPLY, 0.001 ether, 0.0001 ether, CURVE_SUPPLY);

        handler = new CurveHandler(curve, token);
        vm.deal(address(handler), 100 ether);
        targetContract(address(handler));
    }

    function invariant_reserveIsSolventAndSupplyMatchesState() public view {
        IZonkCurve.Curve memory state = curve.curve(address(token));
        assertLe(state.soldSupply, state.curveSupply);
        assertLe(state.reserveBalance, address(curve).balance);
        assertEq(token.balanceOf(address(curve)) + state.soldSupply, state.curveSupply);
    }

    function testHandlerExercisesBuyAndSell() public {
        handler.buy(1);
        handler.sell(1);

        assertGt(handler.buyAttempts(), 0);
        assertGt(handler.sellAttempts(), 0);
        assertGt(handler.successfulBuys(), 0);
        assertGt(handler.successfulSells(), 0);
    }
}
