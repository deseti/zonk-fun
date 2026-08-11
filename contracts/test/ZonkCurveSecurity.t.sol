// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IFeeManager} from "../src/interfaces/IFeeManager.sol";
import {IZonkCurve} from "../src/interfaces/IZonkCurve.sol";
import {FeeManager} from "../src/fees/FeeManager.sol";
import {LiquidityManager} from "../src/liquidity/LiquidityManager.sol";
import {ZonkCurve} from "../src/ZonkCurve.sol";
import {ZonkFactory} from "../src/ZonkFactory.sol";
import {ZonkToken} from "../src/ZonkToken.sol";
import {MockDEXAdapter} from "./mocks/MockDEXAdapter.sol";

contract ReentrantTreasury {
    FeeManager internal feeManager;
    bool public attempted;

    function configure(FeeManager feeManager_) external {
        require(address(feeManager) == address(0), "already configured");
        feeManager = feeManager_;
    }

    function claim() external {
        feeManager.claimProtocolFees();
    }

    receive() external payable {
        attempted = true;
        try feeManager.claimProtocolFees() {} catch {}
    }
}

contract RejectingTreasury {
    function claim(FeeManager feeManager) external {
        feeManager.claimProtocolFees();
    }

    receive() external payable {
        revert("reject");
    }
}

contract ConfigChangingSeller {
    FeeManager internal immutable feeManager;
    ZonkCurve internal immutable curve;
    ZonkToken internal immutable token;
    bool public configurationChanged;

    constructor(FeeManager feeManager_, ZonkCurve curve_, ZonkToken token_) {
        feeManager = feeManager_;
        curve = curve_;
        token = token_;
    }

    function buy(uint256 amount) external {
        (uint256 reserveIn,,,) = curve.quoteBuy(address(token), amount);
        curve.buy{value: reserveIn}(address(token), amount, reserveIn);
    }

    function sell(uint256 amount, uint256 minimumOut) external {
        token.approve(address(curve), amount);
        curve.sell(address(token), amount, minimumOut);
    }

    receive() external payable {
        configurationChanged = true;
        feeManager.setFeeConfiguration(500, 0);
    }
}

contract ForceEther {
    constructor() payable {}

    function force(address payable target) external {
        selfdestruct(target);
    }
}

contract ZonkCurveSecurityTest is Test {
    ZonkFactory internal factory;
    FeeManager internal feeManager;
    ZonkToken internal token;
    ZonkCurve internal curve;
    address internal creator = makeAddr("security-creator");
    address internal buyer = makeAddr("security-buyer");
    address internal treasury = makeAddr("security-treasury");

    uint256 internal constant INITIAL_SUPPLY = 1_000 ether;
    uint256 internal constant CURVE_SUPPLY = 100 ether;
    uint256 internal constant STARTING_PRICE = 0.001 ether;
    uint256 internal constant SLOPE = 0.0001 ether;

    function setUp() public {
        factory = new ZonkFactory();
        feeManager = new FeeManager(address(this), treasury, 100, 100);
        MockDEXAdapter adapter = new MockDEXAdapter();
        LiquidityManager liquidityManager = new LiquidityManager(address(this), address(this), 30 days, 500);
        liquidityManager.configureDexAdapter(address(adapter));
        curve = new ZonkCurve(address(factory), address(feeManager), address(liquidityManager));
        feeManager.grantRole(feeManager.CURVE_ROLE(), address(curve));
        liquidityManager.grantRole(liquidityManager.CURVE_ROLE(), address(curve));
        vm.prank(creator);
        token = ZonkToken(factory.createToken("Secure Zonk", "SZONK", INITIAL_SUPPLY));
        vm.startPrank(creator);
        token.approve(address(curve), CURVE_SUPPLY);
        curve.createCurve(address(token), CURVE_SUPPLY, STARTING_PRICE, SLOPE, CURVE_SUPPLY - 1);
        vm.stopPrank();
        vm.deal(buyer, 100 ether);
    }

    function testTreasuryClaimReentrancyCannotDoubleClaim() public {
        ReentrantTreasury receiver = new ReentrantTreasury();
        feeManager.setTreasury(address(receiver));
        receiver.configure(feeManager);

        _buy(1 ether);
        uint256 accrued = feeManager.protocolFeesAccrued();
        receiver.claim();

        assertTrue(receiver.attempted());
        assertEq(address(receiver).balance, accrued);
        assertEq(feeManager.protocolFeesAccrued(), 0);
    }

    function testRejectingTreasuryCannotBlockTradingOrLoseAccrual() public {
        RejectingTreasury receiver = new RejectingTreasury();
        feeManager.setTreasury(address(receiver));

        _buy(1 ether);
        uint256 accrued = feeManager.protocolFeesAccrued();
        assertGt(accrued, 0);

        vm.expectRevert(IFeeManager.NativeTransferFailed.selector);
        receiver.claim(feeManager);
        assertEq(feeManager.protocolFeesAccrued(), accrued);
    }

    function testSellUsesQuotedFeesBeforeAuthorizedReceiverCallback() public {
        ConfigChangingSeller seller = new ConfigChangingSeller(feeManager, curve, token);
        feeManager.grantRole(feeManager.FEE_CONFIG_ROLE(), address(seller));
        vm.deal(address(seller), 10 ether);
        seller.buy(1 ether);

        (uint256 reserveOut,, uint256 protocolFee, uint256 creatorFee) = curve.quoteSell(address(token), 1 ether);
        uint256 protocolBefore = feeManager.protocolFeesAccrued();
        uint256 creatorBefore = feeManager.creatorFeesAccrued(address(token));
        seller.sell(1 ether, reserveOut);

        assertTrue(seller.configurationChanged());
        assertEq(feeManager.protocolFeesAccrued() - protocolBefore, protocolFee);
        assertEq(feeManager.creatorFeesAccrued(address(token)) - creatorBefore, creatorFee);
        assertEq(feeManager.protocolFeeBps(), 500);
        assertEq(feeManager.creatorFeeBps(), 0);
    }

    function testForcedEtherCannotContaminateReserveOrFeeLiabilities() public {
        ForceEther curveForce = new ForceEther{value: 1 ether}();
        ForceEther feeForce = new ForceEther{value: 1 ether}();
        curveForce.force(payable(address(curve)));
        feeForce.force(payable(address(feeManager)));

        IZonkCurve.Curve memory state = curve.curve(address(token));
        assertEq(state.reserveBalance, 0);
        assertEq(feeManager.totalLiabilities(), 0);
        assertEq(address(curve).balance, 1 ether);
        assertEq(address(feeManager).balance, 1 ether);

        _buy(1 ether);
        state = curve.curve(address(token));
        assertGt(state.reserveBalance, 0);
        assertEq(address(curve).balance, state.reserveBalance + 1 ether);
        assertEq(address(feeManager).balance, feeManager.totalLiabilities() + 1 ether);
    }

    function testDirectEtherAndUnknownCurveCallsRevert() public {
        (bool curveSent,) = address(curve).call{value: 1}("");
        (bool feeSent,) = address(feeManager).call{value: 1}("");
        assertFalse(curveSent);
        assertFalse(feeSent);

        vm.expectRevert(IZonkCurve.CurveNotFound.selector);
        curve.curve(makeAddr("unknown-token"));
    }

    function testNoAdminOrReserveWithdrawalSurface() public {
        (bool curveSuccess,) = address(curve).call(abi.encodeWithSignature("withdraw(address,uint256)", buyer, 1));
        (bool feeSuccess,) = address(feeManager).call(abi.encodeWithSignature("withdraw(address,uint256)", buyer, 1));
        assertFalse(curveSuccess);
        assertFalse(feeSuccess);
    }

    function _buy(uint256 amount) private {
        (uint256 reserveIn,,,) = curve.quoteBuy(address(token), amount);
        vm.prank(buyer);
        curve.buy{value: reserveIn}(address(token), amount, reserveIn);
    }
}
