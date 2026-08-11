// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ILiquidityManager} from "../src/interfaces/ILiquidityManager.sol";
import {IZonkCurve} from "../src/interfaces/IZonkCurve.sol";
import {FeeManager} from "../src/fees/FeeManager.sol";
import {LiquidityManager} from "../src/liquidity/LiquidityManager.sol";
import {ZonkCurve} from "../src/ZonkCurve.sol";
import {ZonkFactory} from "../src/ZonkFactory.sol";
import {ZonkToken} from "../src/ZonkToken.sol";

contract Phase3DeploymentTest is Test {
    ZonkFactory internal factory;
    FeeManager internal feeManager;
    LiquidityManager internal liquidityManager;
    ZonkCurve internal curve;
    ZonkToken internal token;

    address internal creator = makeAddr("phase3-creator");
    address internal buyer = makeAddr("phase3-buyer");
    address internal treasury = makeAddr("phase3-treasury");

    uint256 internal constant CURVE_SUPPLY = 100 ether;
    uint256 internal constant STARTING_PRICE = 0.001 ether;
    uint256 internal constant SLOPE = 0.0001 ether;

    function setUp() public {
        factory = new ZonkFactory();
        feeManager = new FeeManager(address(this), treasury, 100, 100);
        liquidityManager = new LiquidityManager(address(this), address(this), 30 days, 500);
        curve = new ZonkCurve(address(factory), address(feeManager), address(liquidityManager));
        feeManager.grantRole(feeManager.CURVE_ROLE(), address(curve));
        liquidityManager.grantRole(liquidityManager.CURVE_ROLE(), address(curve));

        vm.prank(creator);
        token = ZonkToken(factory.createToken("Phase 3 Zonk", "P3Z", 1_000 ether));
        vm.startPrank(creator);
        token.approve(address(curve), CURVE_SUPPLY);
        curve.createCurve(address(token), CURVE_SUPPLY, STARTING_PRICE, SLOPE, CURVE_SUPPLY - 1);
        vm.stopPrank();
        vm.deal(buyer, 100 ether);
    }

    function testCoreDeploymentAndCreateBuySellWorkWithoutAdapter() public {
        assertFalse(liquidityManager.adapterConfigured());

        vm.prank(creator);
        token.transfer(buyer, 1 ether);

        (uint256 buyValue,,,) = curve.quoteBuy(address(token), 1 ether);
        vm.prank(buyer);
        curve.buy{value: buyValue}(address(token), 1 ether, buyValue);

        uint256 sellAmount = 0.5 ether;
        (uint256 sellValue,,,) = curve.quoteSell(address(token), sellAmount);
        vm.startPrank(buyer);
        token.approve(address(curve), sellAmount);
        curve.sell(address(token), sellAmount, sellValue);
        vm.stopPrank();

        IZonkCurve.Curve memory state = curve.curve(address(token));
        assertEq(state.soldSupply, sellAmount);
        assertEq(uint256(state.lifecycle), uint256(IZonkCurve.Lifecycle.Active));
    }

    function testGraduationFailsClosedUntilAdapterIsConfigured() public {
        (uint256 buyValue,,,) = curve.quoteBuy(address(token), CURVE_SUPPLY - 1);
        vm.prank(buyer);
        curve.buy{value: buyValue}(address(token), CURVE_SUPPLY - 1, buyValue);

        vm.prank(creator);
        vm.expectRevert(ILiquidityManager.AdapterNotConfigured.selector);
        curve.graduate(address(token), block.timestamp + 1 hours);

        IZonkCurve.Curve memory state = curve.curve(address(token));
        assertEq(uint256(state.lifecycle), uint256(IZonkCurve.Lifecycle.GraduationPending));
        assertFalse(liquidityManager.graduationExecuted(address(token)));
    }

    function testDirectLiquidityExecutionRevertsWithoutAdapter() public {
        vm.deal(address(curve), 1 ether);
        vm.expectRevert(ILiquidityManager.AdapterNotConfigured.selector);
        vm.prank(address(curve));
        liquidityManager.createLiquidity{value: 1}(address(token), 1, 1, block.timestamp + 1 hours);
    }
}
