// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ILiquidityManager} from "../src/interfaces/ILiquidityManager.sol";
import {ILPLocker} from "../src/interfaces/ILPLocker.sol";
import {IZonkCurve} from "../src/interfaces/IZonkCurve.sol";
import {FeeManager} from "../src/fees/FeeManager.sol";
import {LPLocker} from "../src/liquidity/LPLocker.sol";
import {LiquidityManager} from "../src/liquidity/LiquidityManager.sol";
import {ZonkCurve} from "../src/ZonkCurve.sol";
import {ZonkFactory} from "../src/ZonkFactory.sol";
import {ZonkToken} from "../src/ZonkToken.sol";
import {MockDEXAdapter, TransferTaxToken} from "./mocks/MockDEXAdapter.sol";

contract LiquidityManagerTest is Test {
    event LiquidityLocked(
        uint256 indexed lockId,
        address indexed liquidityToken,
        address indexed beneficiary,
        uint256 amount,
        uint64 unlockTimestamp
    );
    event LiquidityCreated(
        address indexed token,
        address indexed curve,
        address indexed liquidityToken,
        uint256 tokenAmount,
        uint256 quoteAmount,
        uint256 liquidityAmount,
        uint256 lockId,
        uint64 unlockTimestamp
    );
    event Graduated(
        address indexed token,
        address indexed liquidityToken,
        uint256 tokenAmount,
        uint256 quoteAmount,
        uint256 liquidityAmount,
        uint256 lockId,
        uint64 unlockTimestamp
    );

    ZonkFactory internal factory;
    FeeManager internal feeManager;
    MockDEXAdapter internal adapter;
    LiquidityManager internal liquidityManager;
    ZonkCurve internal curve;
    ZonkToken internal token;

    address internal creator = makeAddr("graduation-creator");
    address internal buyer = makeAddr("graduation-buyer");
    address internal treasury = makeAddr("graduation-treasury");
    address internal beneficiary = makeAddr("lp-beneficiary");
    address internal attacker = makeAddr("graduation-attacker");

    uint256 internal constant CURVE_SUPPLY = 100 ether;
    uint256 internal constant GRADUATION_THRESHOLD = 50 ether;
    uint256 internal constant STARTING_PRICE = 0.001 ether;
    uint256 internal constant SLOPE = 0.0001 ether;
    uint64 internal constant LOCK_DURATION = 30 days;

    function setUp() public {
        factory = new ZonkFactory();
        feeManager = new FeeManager(address(this), treasury, 100, 100);
        adapter = new MockDEXAdapter();
        liquidityManager = new LiquidityManager(address(this), beneficiary, LOCK_DURATION, 500);
        liquidityManager.configureDexAdapter(address(adapter));
        curve = new ZonkCurve(address(factory), address(feeManager), address(liquidityManager));
        feeManager.grantRole(feeManager.CURVE_ROLE(), address(curve));
        liquidityManager.grantRole(liquidityManager.CURVE_ROLE(), address(curve));

        vm.prank(creator);
        token = ZonkToken(factory.createToken("Graduating Zonk", "GZONK", 1_000 ether));
        vm.startPrank(creator);
        token.approve(address(curve), CURVE_SUPPLY);
        curve.createCurve(address(token), CURVE_SUPPLY, STARTING_PRICE, SLOPE, GRADUATION_THRESHOLD);
        vm.stopPrank();
        adapter.configureToken(address(token));
        vm.deal(buyer, 1_000 ether);
    }

    function testGraduationAtExactThresholdMigratesOnlyTrackedReserveAndLocksLP() public {
        _reachThreshold();
        IZonkCurve.Curve memory beforeState = curve.curve(address(token));
        (uint256 tokenAmount, uint256 quoteAmount) = curve.quoteGraduation(address(token));
        uint256 protocolLiability = feeManager.protocolFeesAccrued();
        uint256 creatorLiability = feeManager.creatorFeesAccrued(address(token));

        vm.prank(creator);
        ILiquidityManager.GraduationRecord memory record = curve.graduate(address(token), block.timestamp + 1 hours);

        IZonkCurve.Curve memory afterState = curve.curve(address(token));
        assertEq(uint256(afterState.lifecycle), uint256(IZonkCurve.Lifecycle.Graduated));
        assertEq(afterState.reserveBalance, 0);
        assertEq(tokenAmount, CURVE_SUPPLY - beforeState.soldSupply);
        assertEq(quoteAmount, beforeState.reserveBalance);
        assertEq(record.tokenAmount, tokenAmount);
        assertEq(record.quoteAmount, quoteAmount);
        assertEq(record.liquidityAmount, tokenAmount);
        assertEq(record.creator, creator);
        assertEq(record.curve, address(curve));
        assertTrue(liquidityManager.graduationExecuted(address(token)));
        assertEq(token.balanceOf(address(curve)), 0);
        assertEq(address(curve).balance, 0);
        assertEq(address(feeManager).balance, protocolLiability + creatorLiability);
        assertEq(feeManager.protocolFeesAccrued(), protocolLiability);
        assertEq(feeManager.creatorFeesAccrued(address(token)), creatorLiability);

        ILPLocker.Lock memory lockState = liquidityManager.lpLocker().lock(record.lockId);
        assertEq(lockState.liquidityToken, record.liquidityToken);
        assertEq(lockState.beneficiary, beneficiary);
        assertEq(lockState.amount, record.liquidityAmount);
        assertEq(lockState.unlockTimestamp, record.unlockTimestamp);
        assertEq(IERC20(record.liquidityToken).balanceOf(address(liquidityManager.lpLocker())), record.liquidityAmount);
    }

    function testGraduationEventsMatchFinalState() public {
        _reachThreshold();
        IZonkCurve.Curve memory pendingState = curve.curve(address(token));
        address liquidityToken = adapter.liquidityToken(address(token));
        uint256 tokenAmount = CURVE_SUPPLY - pendingState.soldSupply;
        uint64 unlockTimestamp = uint64(block.timestamp) + LOCK_DURATION;

        vm.expectEmit(true, true, true, true, address(liquidityManager.lpLocker()));
        emit LiquidityLocked(1, liquidityToken, beneficiary, tokenAmount, unlockTimestamp);
        vm.expectEmit(true, true, true, true, address(liquidityManager));
        emit LiquidityCreated(
            address(token),
            address(curve),
            liquidityToken,
            tokenAmount,
            pendingState.reserveBalance,
            tokenAmount,
            1,
            unlockTimestamp
        );
        vm.expectEmit(true, true, false, true, address(curve));
        emit Graduated(
            address(token), liquidityToken, tokenAmount, pendingState.reserveBalance, tokenAmount, 1, unlockTimestamp
        );
        vm.prank(creator);
        curve.graduate(address(token), block.timestamp + 1 hours);
    }

    function testGraduationBelowThresholdAndUnauthorizedGraduationRevert() public {
        vm.prank(creator);
        vm.expectRevert(IZonkCurve.GraduationNotPending.selector);
        curve.graduate(address(token), block.timestamp + 1 hours);

        _reachThreshold();
        vm.prank(attacker);
        vm.expectRevert(IZonkCurve.UnauthorizedGraduation.selector);
        curve.graduate(address(token), block.timestamp + 1 hours);
    }

    function testBuyCannotOvershootGraduationThreshold() public {
        _buy(GRADUATION_THRESHOLD - 1);
        vm.expectRevert(IZonkCurve.GraduationThresholdExceeded.selector);
        curve.quoteBuy(address(token), 2);

        _buy(1);
        IZonkCurve.Curve memory state = curve.curve(address(token));
        assertEq(state.soldSupply, GRADUATION_THRESHOLD);
        assertEq(uint256(state.lifecycle), uint256(IZonkCurve.Lifecycle.GraduationPending));
    }

    function testGovernanceExecutorCanGraduateButCannotExtractReserve() public {
        _reachThreshold();
        uint256 expectedQuote = curve.curve(address(token)).reserveBalance;
        uint256 governanceBefore = address(this).balance;

        curve.graduate(address(token), block.timestamp + 1 hours);

        assertEq(address(this).balance, governanceBefore);
        assertEq(address(adapter).balance, expectedQuote);
        (bool success,) =
            address(liquidityManager).call(abi.encodeWithSignature("withdraw(address,uint256)", address(this), 1));
        assertFalse(success);
    }

    function testDoubleGraduationAndDirectReplayRevert() public {
        _reachThreshold();
        vm.prank(creator);
        ILiquidityManager.GraduationRecord memory record = curve.graduate(address(token), block.timestamp + 1 hours);

        vm.prank(creator);
        vm.expectRevert(IZonkCurve.GraduationNotPending.selector);
        curve.graduate(address(token), block.timestamp + 1 hours);

        vm.deal(address(curve), record.quoteAmount);
        vm.prank(address(curve));
        vm.expectRevert(ILiquidityManager.GraduationAlreadyExecuted.selector);
        liquidityManager.createLiquidity{value: record.quoteAmount}(
            address(token), record.tokenAmount, record.quoteAmount, block.timestamp + 1 hours
        );
    }

    function testPostGraduationBuySellAndQuotesRevert() public {
        _reachThreshold();
        vm.prank(creator);
        curve.graduate(address(token), block.timestamp + 1 hours);
        IZonkCurve.Lifecycle lifecycle = IZonkCurve.Lifecycle.Graduated;

        vm.expectRevert(abi.encodeWithSelector(IZonkCurve.TradingNotActive.selector, lifecycle));
        curve.quoteBuy(address(token), 1);
        vm.expectRevert(abi.encodeWithSelector(IZonkCurve.TradingNotActive.selector, lifecycle));
        curve.quoteSell(address(token), 1);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IZonkCurve.TradingNotActive.selector, lifecycle));
        curve.buy(address(token), 1, type(uint256).max);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IZonkCurve.TradingNotActive.selector, lifecycle));
        curve.sell(address(token), 1, 0);
    }

    function testAdapterFailureIsAtomicAndRetryable() public {
        _reachThreshold();
        IZonkCurve.Curve memory pendingState = curve.curve(address(token));
        uint256 tokenBalance = token.balanceOf(address(curve));
        adapter.setBehavior(MockDEXAdapter.Behavior.RevertCall);

        vm.prank(creator);
        vm.expectRevert();
        curve.graduate(address(token), block.timestamp + 1 hours);
        _assertPendingStateUnchanged(pendingState, tokenBalance);
        assertFalse(liquidityManager.graduationExecuted(address(token)));

        adapter.setBehavior(MockDEXAdapter.Behavior.Success);
        vm.prank(creator);
        curve.graduate(address(token), block.timestamp + 1 hours);
        assertTrue(liquidityManager.graduationExecuted(address(token)));
    }

    function testPartialUseSlippageFailureAndInvalidLPAccountingAreAtomic() public {
        _reachThreshold();
        IZonkCurve.Curve memory pendingState = curve.curve(address(token));
        uint256 tokenBalance = token.balanceOf(address(curve));

        adapter.setBehavior(MockDEXAdapter.Behavior.PartialUse);
        vm.prank(creator);
        vm.expectRevert(ILiquidityManager.InvalidLiquidityAccounting.selector);
        curve.graduate(address(token), block.timestamp + 1 hours);
        _assertPendingStateUnchanged(pendingState, tokenBalance);

        adapter.setBehavior(MockDEXAdapter.Behavior.ReturnZeroLiquidity);
        vm.prank(creator);
        vm.expectRevert(ILiquidityManager.InvalidLiquidityAccounting.selector);
        curve.graduate(address(token), block.timestamp + 1 hours);
        _assertPendingStateUnchanged(pendingState, tokenBalance);

        adapter.setBehavior(MockDEXAdapter.Behavior.SkipLPTransfer);
        vm.prank(creator);
        vm.expectRevert(ILiquidityManager.InvalidLiquidityAccounting.selector);
        curve.graduate(address(token), block.timestamp + 1 hours);
        _assertPendingStateUnchanged(pendingState, tokenBalance);
    }

    function testZeroOrInvalidLiquidityTokenRevertsAtomically() public {
        _reachThreshold();
        IZonkCurve.Curve memory pendingState = curve.curve(address(token));
        uint256 tokenBalance = token.balanceOf(address(curve));

        adapter.setLiquidityToken(address(token), address(0));
        vm.prank(creator);
        vm.expectRevert(ILiquidityManager.InvalidLiquidityToken.selector);
        curve.graduate(address(token), block.timestamp + 1 hours);
        _assertPendingStateUnchanged(pendingState, tokenBalance);

        adapter.setLiquidityToken(address(token), attacker);
        vm.prank(creator);
        vm.expectRevert(ILiquidityManager.InvalidLiquidityToken.selector);
        curve.graduate(address(token), block.timestamp + 1 hours);
        _assertPendingStateUnchanged(pendingState, tokenBalance);
    }

    function testAdapterReentrancyCannotDuplicateGraduation() public {
        _reachThreshold();
        adapter.setCallback(address(curve), abi.encodeCall(curve.graduate, (address(token), block.timestamp + 1 hours)));

        vm.prank(creator);
        curve.graduate(address(token), block.timestamp + 1 hours);

        assertTrue(adapter.callbackAttempted());
        assertFalse(adapter.callbackSucceeded());
        assertTrue(liquidityManager.graduationExecuted(address(token)));
        assertEq(uint256(curve.curve(address(token)).lifecycle), uint256(IZonkCurve.Lifecycle.Graduated));
    }

    function testLPClaimsAreTimelockedAuthorizedAndOneTime() public {
        _reachThreshold();
        vm.prank(creator);
        ILiquidityManager.GraduationRecord memory record = curve.graduate(address(token), block.timestamp + 1 hours);
        ILPLocker locker = liquidityManager.lpLocker();

        vm.prank(attacker);
        vm.expectRevert(ILPLocker.UnauthorizedBeneficiary.selector);
        locker.claim(record.lockId);
        vm.prank(beneficiary);
        vm.expectRevert(ILPLocker.LockNotMature.selector);
        locker.claim(record.lockId);

        vm.warp(record.unlockTimestamp);
        uint256 beneficiaryBefore = IERC20(record.liquidityToken).balanceOf(beneficiary);
        vm.prank(beneficiary);
        assertEq(locker.claim(record.lockId), record.liquidityAmount);
        assertEq(IERC20(record.liquidityToken).balanceOf(beneficiary) - beneficiaryBefore, record.liquidityAmount);

        vm.prank(beneficiary);
        vm.expectRevert(ILPLocker.AlreadyClaimed.selector);
        locker.claim(record.lockId);
    }

    function testLockerRejectsUnauthorizedLocksAndHasNoEarlyWithdrawalSurface() public {
        LPLocker locker = LPLocker(address(liquidityManager.lpLocker()));
        address liquidityToken = adapter.liquidityToken(address(token));

        vm.prank(attacker);
        vm.expectRevert(ILPLocker.UnauthorizedLiquidityManager.selector);
        locker.lockLiquidity(liquidityToken, 1, beneficiary, uint64(block.timestamp + 1 days));

        (bool success,) = address(locker).call(abi.encodeWithSignature("withdraw(address,uint256)", beneficiary, 1));
        assertFalse(success);
    }

    function testFeeLiabilitiesRemainClaimableAfterGraduation() public {
        _reachThreshold();
        uint256 protocolAmount = feeManager.protocolFeesAccrued();
        uint256 creatorAmount = feeManager.creatorFeesAccrued(address(token));
        vm.prank(creator);
        curve.graduate(address(token), block.timestamp + 1 hours);

        uint256 creatorBefore = creator.balance;
        vm.prank(creator);
        assertEq(feeManager.claimCreatorFees(address(token)), creatorAmount);
        assertEq(creator.balance - creatorBefore, creatorAmount);
        uint256 treasuryBefore = treasury.balance;
        vm.prank(treasury);
        assertEq(feeManager.claimProtocolFees(), protocolAmount);
        assertEq(treasury.balance - treasuryBefore, protocolAmount);
    }

    function testUntrackedEtherCannotBeMigratedAsLiquidity() public {
        _reachThreshold();
        uint256 quoteAmount = curve.curve(address(token)).reserveBalance;
        uint256 unrelatedEther = 3 ether;
        vm.deal(address(curve), quoteAmount + unrelatedEther);

        vm.prank(creator);
        curve.graduate(address(token), block.timestamp + 1 hours);

        assertEq(address(adapter).balance, quoteAmount);
        assertEq(address(curve).balance, unrelatedEther);
    }

    function testConfigurationBoundsAndAuthorization() public {
        LiquidityManager unconfigured = new LiquidityManager(address(this), beneficiary, LOCK_DURATION, 500);
        vm.expectRevert(ILiquidityManager.InvalidAdapter.selector);
        unconfigured.configureDexAdapter(address(0));
        vm.expectRevert(ILiquidityManager.InvalidAdapter.selector);
        unconfigured.configureDexAdapter(attacker);
        vm.expectRevert(ILiquidityManager.InvalidGraduationExecutor.selector);
        new LiquidityManager(address(0), beneficiary, LOCK_DURATION, 500);
        vm.expectRevert(ILiquidityManager.InvalidBeneficiary.selector);
        new LiquidityManager(address(this), address(0), LOCK_DURATION, 500);
        vm.expectRevert(ILiquidityManager.InvalidLockDuration.selector);
        new LiquidityManager(address(this), beneficiary, 30 days - 1, 500);
        vm.expectRevert(ILiquidityManager.InvalidLockDuration.selector);
        new LiquidityManager(address(this), beneficiary, uint64(10 * 365 days + 1), 500);
        vm.expectRevert(ILiquidityManager.InvalidSlippage.selector);
        new LiquidityManager(address(this), beneficiary, LOCK_DURATION, 1_001);

        bytes32 role = liquidityManager.CURVE_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, role)
        );
        liquidityManager.registerToken(address(token), creator);

        liquidityManager.grantRole(role, attacker);
        vm.prank(attacker);
        vm.expectRevert(ILiquidityManager.InvalidCurve.selector);
        liquidityManager.registerToken(address(token), creator);

        bytes32 executorRole = liquidityManager.GRADUATION_EXECUTOR_ROLE();
        bytes32 adminRole = liquidityManager.DEFAULT_ADMIN_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, adminRole)
        );
        liquidityManager.grantRole(executorRole, attacker);
    }

    function testDeadlineAndLiquidityAmountValidation() public {
        _reachThreshold();
        vm.prank(creator);
        vm.expectRevert(ILiquidityManager.DeadlineExpired.selector);
        curve.graduate(address(token), block.timestamp - 1);

        vm.deal(address(curve), 1);
        vm.prank(address(curve));
        vm.expectRevert(ILiquidityManager.InsufficientLiquidity.selector);
        liquidityManager.createLiquidity{value: 1}(address(token), 0, 1, block.timestamp + 1);
    }

    function testTransferTaxTokenCannotCorruptLiquidityAccounting() public {
        TransferTaxToken taxToken = new TransferTaxToken();
        MockDEXAdapter taxAdapter = new MockDEXAdapter();
        LiquidityManager manager = new LiquidityManager(address(this), beneficiary, LOCK_DURATION, 500);
        manager.configureDexAdapter(address(taxAdapter));
        manager.grantRole(manager.CURVE_ROLE(), address(this));
        manager.registerToken(address(taxToken), creator);
        taxAdapter.configureToken(address(taxToken));
        taxToken.approve(address(manager), 10 ether);

        vm.expectRevert(ILiquidityManager.InvalidLiquidityAccounting.selector);
        manager.createLiquidity{value: 1 ether}(address(taxToken), 10 ether, 1 ether, block.timestamp + 1 hours);
    }

    function testFuzzSplitBuysReachThresholdExactlyAndExecutionMatchesQuotes(uint96 rawFirstBuy) public {
        uint256 firstBuy = bound(uint256(rawFirstBuy), 1, GRADUATION_THRESHOLD - 1);
        uint256 secondBuy = GRADUATION_THRESHOLD - firstBuy;
        _buy(firstBuy);
        assertEq(uint256(curve.curve(address(token)).lifecycle), uint256(IZonkCurve.Lifecycle.Active));
        _buy(secondBuy);

        IZonkCurve.Curve memory pendingState = curve.curve(address(token));
        assertEq(pendingState.soldSupply, GRADUATION_THRESHOLD);
        assertEq(uint256(pendingState.lifecycle), uint256(IZonkCurve.Lifecycle.GraduationPending));
        vm.prank(creator);
        ILiquidityManager.GraduationRecord memory record = curve.graduate(address(token), block.timestamp + 1 hours);
        assertEq(record.quoteAmount, pendingState.reserveBalance);
        assertEq(record.tokenAmount, CURVE_SUPPLY - GRADUATION_THRESHOLD);
    }

    function _reachThreshold() private {
        _buy(GRADUATION_THRESHOLD);
    }

    function _buy(uint256 amount) private {
        (uint256 reserveIn,,,) = curve.quoteBuy(address(token), amount);
        vm.prank(buyer);
        uint256 actualReserveIn = curve.buy{value: reserveIn}(address(token), amount, reserveIn);
        assertEq(actualReserveIn, reserveIn);
    }

    function _assertPendingStateUnchanged(IZonkCurve.Curve memory expected, uint256 expectedTokenBalance) private view {
        IZonkCurve.Curve memory actual = curve.curve(address(token));
        assertEq(uint256(actual.lifecycle), uint256(IZonkCurve.Lifecycle.GraduationPending));
        assertEq(actual.reserveBalance, expected.reserveBalance);
        assertEq(actual.soldSupply, expected.soldSupply);
        assertEq(address(curve).balance, expected.reserveBalance);
        assertEq(token.balanceOf(address(curve)), expectedTokenBalance);
    }
}
