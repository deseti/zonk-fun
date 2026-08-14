// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {FeeManagerV3} from "../../src/v3/FeeManagerV3.sol";
import {ZonkCurveV3} from "../../src/v3/ZonkCurveV3.sol";
import {ZonkFactoryV3} from "../../src/v3/ZonkFactoryV3.sol";
import {ZonkTokenV3} from "../../src/v3/ZonkTokenV3.sol";
import {MockGraduationManagerV3} from "./mocks/MockGraduationManagerV3.sol";
import {MockUniswapV3FactoryV3, MockWETHV3} from "./mocks/MockUniswapV3.sol";

contract CurveHandlerV3 {
    ZonkCurveV3 public immutable curve;
    ZonkTokenV3 public immutable token;

    constructor(ZonkCurveV3 curve_, ZonkTokenV3 token_) payable {
        curve = curve_;
        token = token_;
        token_.approve(address(curve_), type(uint256).max);
    }

    function buy(uint96 seed) external {
        if (curve.graduated()) return;
        uint256 gross = 1 + (uint256(seed) % 0.05 ether);
        if (address(this).balance < gross) return;
        try curve.buy{value: gross}(0, block.timestamp) {} catch {}
    }

    function sell(uint256 seed) external {
        if (curve.graduated()) return;
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return;
        uint256 amount = 1 + (seed % balance);
        try curve.sell(amount, 0, block.timestamp) {} catch {}
    }

    receive() external payable {}
}

contract ZonkCurveV3InvariantTest is Test {
    uint256 private constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 private constant CURVE_ALLOCATION = 800_000_000 ether;
    uint256 private constant LP_ALLOCATION = 200_000_000 ether;

    FeeManagerV3 private feeManager;
    MockGraduationManagerV3 private graduationManager;
    ZonkFactoryV3 private factory;
    ZonkTokenV3 private token;
    ZonkCurveV3 private curve;
    CurveHandlerV3 private handler;

    function setUp() public {
        feeManager = new FeeManagerV3(address(this), makeAddr("invariantTreasury"));
        MockUniswapV3FactoryV3 uniswapFactory = new MockUniswapV3FactoryV3();
        MockWETHV3 weth = new MockWETHV3();
        graduationManager = new MockGraduationManagerV3(address(uniswapFactory), address(weth));
        factory = new ZonkFactoryV3(address(feeManager), address(graduationManager));
        feeManager.setFactoryOnce(address(factory));
        graduationManager.setFactoryOnce(address(factory));
        (address tokenAddress, address curveAddress) =
            factory.createToken("Invariant V3", "IV3", keccak256("invariant-salt"));
        token = ZonkTokenV3(tokenAddress);
        curve = ZonkCurveV3(payable(curveAddress));
        handler = new CurveHandlerV3{value: 100 ether}(curve, token);
        targetContract(address(handler));
    }

    function invariantTokenSupplyAndAllocationAreConserved() public view {
        assertEq(token.totalSupply(), TOTAL_SUPPLY);
        assertLe(curve.soldSupply(), CURVE_ALLOCATION);
        assertEq(
            token.balanceOf(address(curve)) + token.balanceOf(address(handler))
                + token.balanceOf(address(graduationManager)),
            TOTAL_SUPPLY
        );
        if (curve.graduated()) {
            assertEq(token.balanceOf(address(handler)), CURVE_ALLOCATION);
            assertEq(token.balanceOf(address(graduationManager)), LP_ALLOCATION);
        } else {
            assertEq(token.balanceOf(address(curve)), TOTAL_SUPPLY - curve.soldSupply());
        }
    }

    function invariantReserveAndFeeLiabilitiesAreFullyBacked() public view {
        assertLe(curve.activeEthReserve(), 3 ether);
        assertEq(address(curve).balance, curve.activeEthReserve());
        assertEq(curve.reserveCoordinate(), curve.activeEthReserve() + curve.terminalGraduationReserve());
        assertEq(address(feeManager).balance, feeManager.protocolFeesAccrued() + feeManager.totalCreatorFeesAccrued());
        assertGe(curve.virtualTokenReserve() * curve.virtualEthReserve(), curve.K());
    }

    function invariantGraduationOccursAtMostOnceAndOnlyAtEndpoint() public view {
        assertLe(graduationManager.calls(), 1);
        if (curve.graduated()) {
            assertEq(curve.soldSupply(), CURVE_ALLOCATION);
            assertEq(curve.activeEthReserve(), 0);
            assertEq(curve.terminalGraduationReserve(), 3 ether);
            assertEq(curve.graduationEthForwarded(), 3 ether);
            assertEq(graduationManager.calls(), 1);
        }
    }
}
