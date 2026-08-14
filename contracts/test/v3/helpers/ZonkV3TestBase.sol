// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {FeeManagerV3} from "../../../src/v3/FeeManagerV3.sol";
import {PermanentLPFeeVaultV3} from "../../../src/v3/PermanentLPFeeVaultV3.sol";
import {ZonkCurveV3} from "../../../src/v3/ZonkCurveV3.sol";
import {ZonkFactoryV3} from "../../../src/v3/ZonkFactoryV3.sol";
import {ZonkTokenV3} from "../../../src/v3/ZonkTokenV3.sol";
import {MockGraduationManagerV3} from "../mocks/MockGraduationManagerV3.sol";
import {MockUniswapV3FactoryV3, MockWETHV3} from "../mocks/MockUniswapV3.sol";

abstract contract ZonkV3TestBase is Test {
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 internal constant CURVE_ALLOCATION = 800_000_000 ether;
    uint256 internal constant LP_ALLOCATION = 200_000_000 ether;
    uint256 internal constant GRADUATION_GROSS = 3_030_303_030_303_030_303;

    address internal creator = makeAddr("v3Creator");
    address internal buyer = makeAddr("v3Buyer");
    address internal treasury = makeAddr("v3Treasury");

    FeeManagerV3 internal feeManager;
    PermanentLPFeeVaultV3 internal lpFeeVault;
    MockGraduationManagerV3 internal graduationManager;
    MockUniswapV3FactoryV3 internal uniswapFactory;
    MockWETHV3 internal weth;
    ZonkFactoryV3 internal factory;
    ZonkTokenV3 internal token;
    ZonkCurveV3 internal curve;

    function setUp() public virtual {
        feeManager = new FeeManagerV3(address(this), treasury);
        uniswapFactory = new MockUniswapV3FactoryV3();
        weth = new MockWETHV3();
        graduationManager = new MockGraduationManagerV3(address(uniswapFactory), address(weth));
        factory = new ZonkFactoryV3(address(feeManager), address(graduationManager));
        feeManager.setFactoryOnce(address(factory));
        graduationManager.setFactoryOnce(address(factory));
        lpFeeVault = new PermanentLPFeeVaultV3(address(graduationManager), address(feeManager));
        (token, curve) = _launch(creator, "Endpoint Zonk", "EPZ");
        vm.deal(buyer, 100 ether);
    }

    function _launch(address launchCreator, string memory name, string memory symbol)
        internal
        returns (ZonkTokenV3 launchedToken, ZonkCurveV3 launchedCurve)
    {
        vm.prank(launchCreator);
        bytes32 userSalt = keccak256(abi.encode(launchCreator, name, symbol));
        (address tokenAddress, address curveAddress) = factory.createToken(name, symbol, userSalt);
        launchedToken = ZonkTokenV3(tokenAddress);
        launchedCurve = ZonkCurveV3(payable(curveAddress));
    }

    function _buy(address account, ZonkCurveV3 targetCurve, uint256 gross) internal returns (uint256 tokensOut) {
        ZonkCurveV3.BuyQuote memory quote = targetCurve.quoteBuy(gross);
        vm.prank(account);
        ZonkCurveV3.BuyQuote memory executed = targetCurve.buy{value: gross}(quote.tokensOut, block.timestamp + 1 hours);
        return executed.tokensOut;
    }
}
