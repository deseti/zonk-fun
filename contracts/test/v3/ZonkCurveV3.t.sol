// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IZonkCurveV3} from "../../src/v3/interfaces/IZonkCurveV3.sol";
import {ZonkV3TestBase} from "./helpers/ZonkV3TestBase.sol";

contract ForceEtherCurveV3 {
    constructor() payable {}

    function force(address payable to) external {
        selfdestruct(to);
    }
}

contract ZonkCurveV3Test is ZonkV3TestBase {
    function testForcedEthDoesNotChangeQuotesOrGraduationAccounting() public {
        IZonkCurveV3.BuyQuote memory beforeQuote = curve.quoteBuy(GRADUATION_GROSS);
        ForceEtherCurveV3 force = new ForceEtherCurveV3{value: 2 ether}();
        force.force(payable(address(curve)));
        IZonkCurveV3.BuyQuote memory afterQuote = curve.quoteBuy(GRADUATION_GROSS);
        assertEq(keccak256(abi.encode(beforeQuote)), keccak256(abi.encode(afterQuote)));
        assertEq(curve.unaccountedEth(), 2 ether);
        vm.prank(buyer);
        curve.buy{value: afterQuote.acceptedGross}(afterQuote.tokensOut, block.timestamp);
        assertTrue(curve.graduated());
        assertEq(curve.activeEthReserve(), 0);
        assertEq(curve.terminalGraduationReserve(), 3 ether);
        assertEq(curve.graduationEthForwarded(), 3 ether);
        assertEq(address(curve).balance, 2 ether);
        assertEq(curve.unaccountedEth(), 2 ether);
    }

    function testCanonicalConstantsAndInitialEndpoint() public view {
        assertEq(curve.PROTOCOL_VERSION(), "endpoint-cp-v3");
        assertEq(curve.TOTAL_SUPPLY(), 1_000_000_000 ether);
        assertEq(curve.CURVE_ALLOCATION(), 800_000_000 ether);
        assertEq(curve.LP_ALLOCATION(), 200_000_000 ether);
        assertEq(curve.VIRTUAL_TOKEN_RESERVE(), 1_066_666_666_666_666_666_666_666_667);
        assertEq(curve.VIRTUAL_ETH_RESERVE(), 1 ether);
        assertEq(curve.GRADUATION_RESERVE(), 3 ether);
        assertEq(curve.EXACT_GRADUATION_GROSS(), GRADUATION_GROSS);
        assertEq(curve.spotPrice(), 937_500_000);
        assertEq(curve.spotPrice() * 1_000_000_000, 0.9375 ether);
    }

    function testGrossRequiredForNetMatchesCanonicalVectors() public view {
        assertEq(curve.grossRequiredForNet(1), 1);
        assertEq(curve.grossRequiredForNet(99), 99);
        assertEq(curve.grossRequiredForNet(100), 101);
        assertEq(curve.grossRequiredForNet(3 ether), GRADUATION_GROSS);
        for (uint256 net = 1; net < 10_000; ++net) {
            uint256 gross = curve.grossRequiredForNet(net);
            assertEq(gross - gross / 100, net);
            assertLt((gross - 1) - ((gross - 1) / 100), net);
        }
    }

    function testGrossRequiredForNetRejectsUnrepresentableGrossWithoutOverflowPanic() public {
        vm.expectRevert(IZonkCurveV3.InvalidAmount.selector);
        curve.grossRequiredForNet(type(uint256).max);
    }

    function testAcceptedSimulatorBuyVector() public {
        IZonkCurveV3.BuyQuote memory quote = curve.quoteBuy(0.1 ether);
        assertEq(quote.protocolFee, 500_000_000_000_000);
        assertEq(quote.creatorFee, 500_000_000_000_000);
        assertEq(quote.netCurveInput, 99_000_000_000_000_000);
        assertEq(quote.tokensOut, 96_087_352_138_307_552_320_291_173);

        vm.prank(buyer);
        IZonkCurveV3.BuyQuote memory executed = curve.buy{value: 0.1 ether}(quote.tokensOut, block.timestamp);
        assertEq(keccak256(abi.encode(executed)), keccak256(abi.encode(quote)));
        assertEq(curve.activeEthReserve(), 99_000_000_000_000_000);
        assertEq(curve.spotPrice(), 1_132_313_438);
    }

    function testDifferentialAcceptedLaunchVectors() public view {
        uint256[9] memory grossInputs = [
            uint256(10_000_000_000_000),
            100_000_000_000_000,
            1_000_000_000_000_000,
            10_000_000_000_000_000,
            50_000_000_000_000_000,
            100_000_000_000_000_000,
            250_000_000_000_000_000,
            500_000_000_000_000_000,
            1_000_000_000_000_000_000
        ];
        uint256[9] memory expectedTokens = [
            uint256(10_559_895_457_034_975_353_743),
            105_589_546_634_883_146_568_489,
            1_054_955_593_961_977_642_134_287,
            10_456_480_839_687_097_732_448_757,
            50_309_671_272_034_302_048_594_568,
            96_087_352_138_307_552_320_291_173,
            211_623_246_492_985_971_943_887_775,
            353_177_257_525_083_612_040_133_779,
            530_653_266_331_658_291_457_286_432
        ];
        for (uint256 i; i < grossInputs.length; ++i) {
            IZonkCurveV3.BuyQuote memory quote = curve.quoteBuy(grossInputs[i]);
            assertEq(quote.acceptedGross, grossInputs[i]);
            assertEq(quote.netCurveInput, grossInputs[i] - grossInputs[i] / 100);
            assertEq(quote.tokensOut, expectedTokens[i]);
        }
    }

    function testOneWeiBelowExactAndOneWeiAboveGraduationBoundary() public {
        IZonkCurveV3.BuyQuote memory belowQuote = curve.quoteBuy(GRADUATION_GROSS - 1);
        assertFalse(belowQuote.reachesGraduation);
        assertEq(belowQuote.refund, 0);
        assertEq(belowQuote.netCurveInput, 3 ether - 1);

        vm.prank(buyer);
        curve.buy{value: GRADUATION_GROSS - 1}(belowQuote.tokensOut, block.timestamp);
        assertFalse(curve.graduated());
        assertEq(curve.activeEthReserve(), 3 ether - 1);

        IZonkCurveV3.BuyQuote memory lastWei = curve.quoteBuy(1);
        assertTrue(lastWei.reachesGraduation);
        assertEq(lastWei.acceptedGross, 1);
        assertEq(lastWei.refund, 0);
        vm.prank(buyer);
        curve.buy{value: 1}(lastWei.tokensOut, block.timestamp);
        assertTrue(curve.graduated());
        assertEq(curve.activeEthReserve(), 0);
        assertEq(curve.terminalGraduationReserve(), 3 ether);
        assertEq(curve.soldSupply(), CURVE_ALLOCATION);
        assertEq(curve.spotPrice(), 15_000_000_000);
    }

    function testExactBoundaryGraduatesAndForwardsPrincipal() public {
        vm.prank(buyer);
        IZonkCurveV3.BuyQuote memory quote = curve.buy{value: GRADUATION_GROSS}(0, block.timestamp);
        assertTrue(quote.reachesGraduation);
        assertEq(quote.refund, 0);
        assertEq(curve.activeEthReserve(), 0);
        assertEq(curve.terminalGraduationReserve(), 3 ether);
        assertEq(curve.graduationEthForwarded(), 3 ether);
        assertEq(curve.soldSupply(), CURVE_ALLOCATION);
        assertEq(token.balanceOf(buyer), CURVE_ALLOCATION);
        assertEq(token.balanceOf(address(graduationManager)), LP_ALLOCATION);
        assertEq(address(graduationManager).balance, 3 ether);
        assertEq(address(curve).balance, 0);
        assertEq(graduationManager.calls(), 1);
        assertEq(graduationManager.lastCreator(), creator);
    }

    function testOneWeiAboveBoundaryRefundsAndFeesOnlyAcceptedGross() public {
        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        IZonkCurveV3.BuyQuote memory quote = curve.buy{value: GRADUATION_GROSS + 1}(0, block.timestamp);
        assertEq(quote.acceptedGross, GRADUATION_GROSS);
        assertEq(quote.refund, 1);
        assertEq(buyerBefore - buyer.balance, GRADUATION_GROSS);
        assertEq(feeManager.protocolFeesAccrued(), 15_151_515_151_515_151);
        assertEq(feeManager.creatorFeesAccrued(address(token)), 15_151_515_151_515_152);
    }

    function testOddFeeWeiAlwaysBelongsToCreator() public {
        IZonkCurveV3.FeeSplit memory split = curve.splitFee(100);
        assertEq(split.totalFee, 1);
        assertEq(split.protocolFee, 0);
        assertEq(split.creatorFee, 1);
        vm.prank(buyer);
        curve.buy{value: 100}(0, block.timestamp);
        assertEq(feeManager.protocolFeesAccrued(), 0);
        assertEq(feeManager.creatorFeesAccrued(address(token)), 1);
        assertEq(curve.activeEthReserve(), 99);
    }

    function testBuyAndSellQuoteExecutionParityAndRoundTripAccounting() public {
        IZonkCurveV3.BuyQuote memory buyQuote = curve.quoteBuy(1 ether);
        vm.prank(buyer);
        IZonkCurveV3.BuyQuote memory buyExecution = curve.buy{value: 1 ether}(buyQuote.tokensOut, block.timestamp);
        assertEq(keccak256(abi.encode(buyQuote)), keccak256(abi.encode(buyExecution)));

        vm.prank(buyer);
        token.approve(address(curve), buyQuote.tokensOut);
        IZonkCurveV3.SellQuote memory sellQuote = curve.quoteSell(buyQuote.tokensOut);
        vm.prank(buyer);
        IZonkCurveV3.SellQuote memory sellExecution =
            curve.sell(buyQuote.tokensOut, sellQuote.netSellerOutput, block.timestamp);
        assertEq(keccak256(abi.encode(sellQuote)), keccak256(abi.encode(sellExecution)));
        assertEq(sellQuote.grossCurveOutput, buyQuote.netCurveInput);
        assertEq(curve.activeEthReserve(), 0);
        assertEq(curve.soldSupply(), 0);
        assertEq(token.balanceOf(address(curve)), TOTAL_SUPPLY);
    }

    function testTokenAndEthConservationDuringBuyAndSell() public {
        uint256 gross = 0.5 ether;
        uint256 buyerEthBefore = buyer.balance;
        uint256 tokensOut = _buy(buyer, curve, gross);
        assertEq(token.balanceOf(address(curve)) + token.balanceOf(buyer), TOTAL_SUPPLY);
        assertEq(address(curve).balance + address(feeManager).balance + buyer.balance, buyerEthBefore);

        vm.startPrank(buyer);
        token.approve(address(curve), tokensOut);
        curve.sell(tokensOut, 0, block.timestamp);
        vm.stopPrank();
        assertEq(token.balanceOf(address(curve)), TOTAL_SUPPLY);
        assertEq(curve.activeEthReserve(), 0);
        assertEq(address(curve).balance, 0);
    }

    function testReservedInventoryCannotBePurchasedOrWithdrawn() public {
        vm.prank(buyer);
        curve.buy{value: GRADUATION_GROSS}(0, block.timestamp);
        assertEq(token.balanceOf(buyer), CURVE_ALLOCATION);
        assertEq(token.balanceOf(address(graduationManager)), LP_ALLOCATION);
        assertEq(token.balanceOf(creator), 0);
        assertEq(token.balanceOf(address(factory)), 0);
        (bool success,) = address(curve).call(abi.encodeWithSignature("withdraw(address,uint256)", creator, 1));
        assertFalse(success);
    }

    function testTradingAfterGraduationAndSecondGraduationPathReject() public {
        vm.prank(buyer);
        curve.buy{value: GRADUATION_GROSS}(0, block.timestamp);
        vm.expectRevert(IZonkCurveV3.TradingClosed.selector);
        curve.quoteBuy(1);
        vm.expectRevert(IZonkCurveV3.TradingClosed.selector);
        curve.quoteSell(1);
        assertEq(graduationManager.calls(), 1);
    }

    function testDeadlineSlippageZeroAndDustProtection() public {
        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        vm.expectRevert(IZonkCurveV3.InvalidAmount.selector);
        curve.buy{value: 0}(0, block.timestamp);

        IZonkCurveV3.BuyQuote memory quote = curve.quoteBuy(0.01 ether);
        vm.prank(buyer);
        vm.expectRevert(IZonkCurveV3.SlippageExceeded.selector);
        curve.buy{value: 0.01 ether}(quote.tokensOut + 1, block.timestamp);
        vm.prank(buyer);
        vm.expectRevert(IZonkCurveV3.DeadlineExpired.selector);
        curve.buy{value: 0.01 ether}(0, block.timestamp - 1);

        _buy(buyer, curve, 0.01 ether);
        vm.expectRevert(IZonkCurveV3.DustTrade.selector);
        curve.quoteSell(1);
    }

    function testSellDeadlineAndSlippageProtection() public {
        uint256 tokensOut = _buy(buyer, curve, 0.1 ether);
        IZonkCurveV3.SellQuote memory quote = curve.quoteSell(tokensOut);
        vm.startPrank(buyer);
        token.approve(address(curve), tokensOut);
        vm.expectRevert(IZonkCurveV3.SlippageExceeded.selector);
        curve.sell(tokensOut, quote.netSellerOutput + 1, block.timestamp);
        vm.expectRevert(IZonkCurveV3.DeadlineExpired.selector);
        curve.sell(tokensOut, 0, block.timestamp - 1);
        vm.stopPrank();
        assertEq(curve.soldSupply(), tokensOut);
        assertEq(token.balanceOf(buyer), tokensOut);
    }

    function testFuzzBuyQuoteExecutionParity(uint96 rawGross) public {
        uint256 gross = bound(uint256(rawGross), 1, 2 ether);
        IZonkCurveV3.BuyQuote memory quote = curve.quoteBuy(gross);
        vm.prank(buyer);
        IZonkCurveV3.BuyQuote memory execution = curve.buy{value: gross}(quote.tokensOut, block.timestamp);
        assertEq(keccak256(abi.encode(quote)), keccak256(abi.encode(execution)));
        assertLe(curve.soldSupply(), CURVE_ALLOCATION);
        assertLe(curve.activeEthReserve(), 3 ether);
        assertGe(curve.virtualTokenReserve() * curve.virtualEthReserve(), curve.K());
    }

    function testFuzzSellQuoteExecutionParity(uint96 rawGross, uint256 rawTokens) public {
        uint256 gross = bound(uint256(rawGross), 0.01 ether, 1 ether);
        uint256 purchased = _buy(buyer, curve, gross);
        uint256 tokensIn = bound(rawTokens, 2_000_000_000, purchased);
        IZonkCurveV3.SellQuote memory quote = curve.quoteSell(tokensIn);
        vm.startPrank(buyer);
        token.approve(address(curve), tokensIn);
        IZonkCurveV3.SellQuote memory execution = curve.sell(tokensIn, quote.netSellerOutput, block.timestamp);
        vm.stopPrank();
        assertEq(keccak256(abi.encode(quote)), keccak256(abi.encode(execution)));
        assertLe(quote.grossCurveOutput, gross);
        assertGe(curve.virtualTokenReserve() * curve.virtualEthReserve(), curve.K());
    }
}

contract ZonkTokenV3Test is ZonkV3TestBase {
    function testFixedSupplySingleMintAndZeroCreatorAllocation() public view {
        assertEq(token.totalSupply(), TOTAL_SUPPLY);
        assertEq(token.balanceOf(address(curve)), TOTAL_SUPPLY);
        assertEq(token.balanceOf(creator), 0);
        assertEq(token.creator(), creator);
    }

    function testNoMintOrInventoryAdminSurface() public {
        (bool mintSuccess,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", creator, 1));
        (bool seizeSuccess,) = address(token).call(abi.encodeWithSignature("seize(address,uint256)", creator, 1));
        assertFalse(mintSuccess);
        assertFalse(seizeSuccess);
        assertEq(token.totalSupply(), TOTAL_SUPPLY);
    }
}
