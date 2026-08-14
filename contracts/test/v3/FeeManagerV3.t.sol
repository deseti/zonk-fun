// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IFeeManagerV3} from "../../src/v3/interfaces/IFeeManagerV3.sol";
import {FeeManagerV3} from "../../src/v3/FeeManagerV3.sol";
import {ZonkCurveV3} from "../../src/v3/ZonkCurveV3.sol";
import {ZonkTokenV3} from "../../src/v3/ZonkTokenV3.sol";
import {ZonkV3TestBase} from "./helpers/ZonkV3TestBase.sol";

contract PayoutReceiverV3 {
    bool public rejectPayment;

    function setRejectPayment(bool rejectPayment_) external {
        rejectPayment = rejectPayment_;
    }

    function acceptCreator(FeeManagerV3 manager, address token) external {
        manager.acceptCreatorPayout(token);
    }

    function acceptTreasury(FeeManagerV3 manager) external {
        manager.acceptTreasury();
    }

    receive() external payable {
        if (rejectPayment) revert("REJECT_PAYMENT");
    }
}

contract FeeManagerV3Test is ZonkV3TestBase {
    function testUnauthorizedDepositAndExactMsgValueValidation() public {
        vm.deal(address(curve), 1 ether);
        vm.prank(buyer);
        vm.expectRevert(IFeeManagerV3.UnauthorizedCurve.selector);
        feeManager.depositFees{value: 1}(address(token), 1, 0, true);

        vm.prank(address(curve));
        vm.expectRevert(IFeeManagerV3.InvalidFeeValue.selector);
        feeManager.depositFees{value: 2}(address(token), 1, 0, true);
    }

    function testFeeAccountingIsIsolatedAcrossTokens() public {
        (ZonkTokenV3 tokenTwo, ZonkCurveV3 curveTwo) = _launch(makeAddr("creatorTwo"), "Second", "TWO");
        _buy(buyer, curve, 0.1 ether);
        _buy(buyer, curveTwo, 0.25 ether);
        assertEq(feeManager.creatorFeesAccrued(address(token)), 500_000_000_000_000);
        assertEq(feeManager.creatorFeesAccrued(address(tokenTwo)), 1_250_000_000_000_000);
        assertEq(feeManager.protocolFeesAccrued(), 1_750_000_000_000_000);
        assertEq(feeManager.totalCreatorFeesAccrued(), 1_750_000_000_000_000);
    }

    function testCreatorPayoutProposeAcceptAndClaimsRemainAtOldUntilAcceptance() public {
        _buy(buyer, curve, 0.1 ether);
        PayoutReceiverV3 receiver = new PayoutReceiverV3();
        vm.prank(creator);
        feeManager.proposeCreatorPayout(address(token), address(receiver));
        assertEq(feeManager.creatorPayoutOf(address(token)), creator);

        uint256 creatorBefore = creator.balance;
        vm.prank(buyer);
        feeManager.claimCreatorFees(address(token));
        assertEq(creator.balance - creatorBefore, 500_000_000_000_000);

        _buy(buyer, curve, 0.1 ether);
        receiver.acceptCreator(feeManager, address(token));
        uint256 receiverBefore = address(receiver).balance;
        vm.prank(buyer);
        feeManager.claimCreatorFees(address(token));
        assertEq(address(receiver).balance - receiverBefore, 500_000_000_000_000);
        assertEq(feeManager.creatorOf(address(token)), creator);
    }

    function testUnauthorizedCreatorRotationRejected() public {
        vm.prank(buyer);
        vm.expectRevert(IFeeManagerV3.UnauthorizedCreator.selector);
        feeManager.proposeCreatorPayout(address(token), buyer);
        vm.prank(buyer);
        vm.expectRevert(IFeeManagerV3.UnauthorizedPendingPayout.selector);
        feeManager.acceptCreatorPayout(address(token));
    }

    function testTreasuryRotationRequiresOwnerDelayAndPendingAcceptance() public {
        PayoutReceiverV3 newTreasury = new PayoutReceiverV3();
        feeManager.proposeTreasury(address(newTreasury));
        assertEq(feeManager.treasury(), treasury);
        vm.expectRevert(IFeeManagerV3.TreasuryDelayNotElapsed.selector);
        newTreasury.acceptTreasury(feeManager);
        vm.warp(block.timestamp + 48 hours);
        newTreasury.acceptTreasury(feeManager);
        assertEq(feeManager.treasury(), address(newTreasury));
        assertEq(feeManager.pendingTreasury(), address(0));
    }

    function testUnauthorizedTreasuryRotationRejected() public {
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, buyer));
        feeManager.proposeTreasury(buyer);

        feeManager.proposeTreasury(buyer);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(creator);
        vm.expectRevert(IFeeManagerV3.UnauthorizedPendingTreasury.selector);
        feeManager.acceptTreasury();
    }

    function testRejectingCreatorClaimPreservesAccountingAndDoesNotBlockTrading() public {
        PayoutReceiverV3 receiver = new PayoutReceiverV3();
        vm.prank(creator);
        feeManager.proposeCreatorPayout(address(token), address(receiver));
        receiver.acceptCreator(feeManager, address(token));
        receiver.setRejectPayment(true);
        _buy(buyer, curve, 0.1 ether);
        uint256 accrued = feeManager.creatorFeesAccrued(address(token));
        vm.expectRevert(IFeeManagerV3.NativeTransferFailed.selector);
        feeManager.claimCreatorFees(address(token));
        assertEq(feeManager.creatorFeesAccrued(address(token)), accrued);
        assertEq(feeManager.totalCreatorFeesAccrued(), accrued);

        _buy(buyer, curve, 0.01 ether);
        assertGt(feeManager.creatorFeesAccrued(address(token)), accrued);
    }

    function testRejectingProtocolClaimPreservesAccounting() public {
        PayoutReceiverV3 receiver = new PayoutReceiverV3();
        feeManager.proposeTreasury(address(receiver));
        vm.warp(block.timestamp + 48 hours);
        receiver.acceptTreasury(feeManager);
        receiver.setRejectPayment(true);
        _buy(buyer, curve, 0.1 ether);
        uint256 accrued = feeManager.protocolFeesAccrued();
        vm.expectRevert(IFeeManagerV3.NativeTransferFailed.selector);
        feeManager.claimProtocolFees();
        assertEq(feeManager.protocolFeesAccrued(), accrued);
    }

    function testFactoryCanOnlyBeSetOnceAndNoGenericRescueExists() public {
        vm.expectRevert(IFeeManagerV3.FactoryAlreadySet.selector);
        feeManager.setFactoryOnce(address(factory));
        (bool success,) = address(feeManager).call(abi.encodeWithSignature("rescueETH(address,uint256)", buyer, 1));
        assertFalse(success);
    }

    function testCreatorCanCancelPendingPayoutProposal() public {
        vm.prank(creator);
        feeManager.proposeCreatorPayout(address(token), buyer);
        assertEq(feeManager.pendingCreatorPayoutOf(address(token)), buyer);

        vm.prank(creator);
        feeManager.cancelCreatorPayout(address(token));
        assertEq(feeManager.pendingCreatorPayoutOf(address(token)), address(0));
        assertEq(feeManager.creatorPayoutOf(address(token)), creator);
    }

    function testOwnerCanCancelPendingTreasuryProposal() public {
        feeManager.proposeTreasury(buyer);
        feeManager.cancelTreasuryProposal();
        assertEq(feeManager.pendingTreasury(), address(0));
        assertEq(feeManager.pendingTreasuryAcceptAfter(), 0);
        assertEq(feeManager.treasury(), treasury);
    }

    function testPendingTreasuryIsInvalidatedWhenOwnershipTransfers() public {
        address newOwner = makeAddr("newFeeManagerOwner");
        feeManager.proposeTreasury(buyer);
        feeManager.transferOwnership(newOwner);
        vm.prank(newOwner);
        feeManager.acceptOwnership();

        assertEq(feeManager.owner(), newOwner);
        assertEq(feeManager.pendingTreasury(), address(0));
        assertEq(feeManager.pendingTreasuryAcceptAfter(), 0);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(buyer);
        vm.expectRevert(IFeeManagerV3.UnauthorizedPendingTreasury.selector);
        feeManager.acceptTreasury();
    }

    function testPendingTreasuryIsInvalidatedWhenOwnershipRenounced() public {
        feeManager.proposeTreasury(buyer);
        feeManager.renounceOwnership();

        assertEq(feeManager.owner(), address(0));
        assertEq(feeManager.pendingTreasury(), address(0));
        assertEq(feeManager.pendingTreasuryAcceptAfter(), 0);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(buyer);
        vm.expectRevert(IFeeManagerV3.UnauthorizedPendingTreasury.selector);
        feeManager.acceptTreasury();
    }
}
