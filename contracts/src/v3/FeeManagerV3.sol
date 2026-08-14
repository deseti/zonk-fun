// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFeeManagerV3} from "./interfaces/IFeeManagerV3.sol";
import {IZonkCurveV3} from "./interfaces/IZonkCurveV3.sol";
import {IZonkFactoryV3} from "./interfaces/IZonkFactoryV3.sol";
import {IZonkTokenV3} from "./interfaces/IZonkTokenV3.sol";

/// @notice Pull-based custody of endpoint curve ETH fees and recipient lifecycle only.
contract FeeManagerV3 is IFeeManagerV3, Ownable2Step, ReentrancyGuard {
    bytes32 public constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v3");
    uint64 public constant TREASURY_ROTATION_DELAY = 48 hours;

    address public override factory;
    address public override factoryBootstrapAuthority;
    address public override treasury;
    address public override pendingTreasury;
    uint64 public override pendingTreasuryAcceptAfter;
    mapping(address token => address curve) public override curveOf;
    mapping(address token => address creator) public override creatorOf;
    mapping(address token => address payout) public override creatorPayoutOf;
    mapping(address token => address payout) public override pendingCreatorPayoutOf;
    mapping(address token => uint256 amount) public override creatorFeesAccrued;
    uint256 public override protocolFeesAccrued;
    uint256 public override totalCreatorFeesAccrued;

    constructor(address governance, address initialTreasury) Ownable(governance) {
        if (initialTreasury == address(0)) revert InvalidTreasury();
        factoryBootstrapAuthority = governance;
        treasury = initialTreasury;
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function setFactoryOnce(address factory_) external override {
        if (factory != address(0)) revert FactoryAlreadySet();
        if (msg.sender != factoryBootstrapAuthority || factoryBootstrapAuthority == address(0)) {
            revert UnauthorizedBootstrap();
        }
        if (factory_ == address(0) || factory_.code.length == 0) revert InvalidFactory();
        if (IZonkFactoryV3(factory_).protocolVersionHash() != PROTOCOL_VERSION_HASH) revert FactoryVersionMismatch();
        address consumedAuthority = factoryBootstrapAuthority;
        factory = factory_;
        factoryBootstrapAuthority = address(0);
        emit FactorySet(factory_);
        emit FactoryBootstrapConsumed(consumedAuthority);
    }

    function registerToken(address token, address curve, address creator) external override {
        if (factory == address(0)) revert FactoryNotSet();
        if (msg.sender != factory) revert UnauthorizedFactory();
        if (token == address(0) || token.code.length == 0) revert InvalidToken();
        if (curve == address(0) || curve.code.length == 0) revert InvalidCurve();
        if (creator == address(0)) revert InvalidCreator();
        if (curveOf[token] != address(0)) revert TokenAlreadyRegistered();
        (address registeredCreator, address registeredCurve) = IZonkFactoryV3(factory).tokenInfo(token);
        if (
            !IZonkFactoryV3(factory).isToken(token) || IZonkFactoryV3(factory).curveOf(token) != curve
                || registeredCurve != curve || registeredCreator != creator || IZonkCurveV3(curve).factory() != factory
                || IZonkCurveV3(curve).token() != token || IZonkCurveV3(curve).creator() != creator
                || IZonkTokenV3(token).factory() != factory || IZonkTokenV3(token).creator() != creator
                || !IZonkTokenV3(token).initialized()
        ) revert TokenRelationshipMismatch();
        curveOf[token] = curve;
        creatorOf[token] = creator;
        creatorPayoutOf[token] = creator;
        emit TokenRegistered(token, curve, creator, creator);
    }

    function depositFees(address token, uint256 protocolFee, uint256 creatorFee, bool isBuy) external payable override {
        if (curveOf[token] != msg.sender) revert UnauthorizedCurve();
        if (msg.value != protocolFee + creatorFee) revert InvalidFeeValue();
        protocolFeesAccrued += protocolFee;
        creatorFeesAccrued[token] += creatorFee;
        totalCreatorFeesAccrued += creatorFee;
        emit FeesDeposited(token, msg.sender, isBuy, protocolFee, creatorFee);
    }

    function proposeCreatorPayout(address token, address proposedPayout) external override {
        if (msg.sender != creatorOf[token]) revert UnauthorizedCreator();
        if (proposedPayout == address(0)) revert InvalidPayoutRecipient();
        if (proposedPayout == creatorPayoutOf[token]) revert CreatorPayoutUnchanged();
        pendingCreatorPayoutOf[token] = proposedPayout;
        emit CreatorPayoutProposed(token, creatorPayoutOf[token], proposedPayout);
    }

    function acceptCreatorPayout(address token) external override {
        address proposedPayout = pendingCreatorPayoutOf[token];
        if (msg.sender != proposedPayout || proposedPayout == address(0)) revert UnauthorizedPendingPayout();
        address previousPayout = creatorPayoutOf[token];
        creatorPayoutOf[token] = proposedPayout;
        delete pendingCreatorPayoutOf[token];
        emit CreatorPayoutAccepted(token, previousPayout, proposedPayout);
    }

    function cancelCreatorPayout(address token) external override {
        if (msg.sender != creatorOf[token]) revert UnauthorizedCreator();
        address cancelledPayout = pendingCreatorPayoutOf[token];
        if (cancelledPayout == address(0)) revert NoPendingProposal();
        delete pendingCreatorPayoutOf[token];
        emit CreatorPayoutCancelled(token, cancelledPayout);
    }

    function proposeTreasury(address proposedTreasury) external override onlyOwner {
        if (proposedTreasury == address(0)) revert InvalidTreasury();
        if (proposedTreasury == treasury) revert TreasuryUnchanged();
        uint64 acceptAfter = uint64(block.timestamp + TREASURY_ROTATION_DELAY);
        pendingTreasury = proposedTreasury;
        pendingTreasuryAcceptAfter = acceptAfter;
        emit TreasuryProposed(treasury, proposedTreasury, acceptAfter);
    }

    function acceptTreasury() external override {
        address proposedTreasury = pendingTreasury;
        if (msg.sender != proposedTreasury || proposedTreasury == address(0)) revert UnauthorizedPendingTreasury();
        if (block.timestamp < pendingTreasuryAcceptAfter) revert TreasuryDelayNotElapsed();
        address previousTreasury = treasury;
        treasury = proposedTreasury;
        delete pendingTreasury;
        delete pendingTreasuryAcceptAfter;
        emit TreasuryAccepted(previousTreasury, proposedTreasury);
    }

    function cancelTreasuryProposal() external override onlyOwner {
        address cancelledTreasury = pendingTreasury;
        if (cancelledTreasury == address(0)) revert NoPendingProposal();
        delete pendingTreasury;
        delete pendingTreasuryAcceptAfter;
        emit TreasuryProposalCancelled(cancelledTreasury);
    }

    function claimProtocolFees() external override nonReentrant returns (uint256 amount) {
        amount = protocolFeesAccrued;
        if (amount == 0) revert NothingToClaim();
        protocolFeesAccrued = 0;
        _sendNative(treasury, amount);
        emit ProtocolFeesClaimed(treasury, msg.sender, amount);
    }

    function claimCreatorFees(address token) external override nonReentrant returns (uint256 amount) {
        amount = creatorFeesAccrued[token];
        if (amount == 0) revert NothingToClaim();
        creatorFeesAccrued[token] = 0;
        totalCreatorFeesAccrued -= amount;
        address payout = creatorPayoutOf[token];
        _sendNative(payout, amount);
        emit CreatorFeesClaimed(token, payout, msg.sender, amount);
    }

    function totalLiabilities() external view returns (uint256) {
        return protocolFeesAccrued + totalCreatorFeesAccrued;
    }

    receive() external payable {
        revert UnexpectedEther();
    }

    function _transferOwnership(address newOwner) internal override {
        address cancelledTreasury = pendingTreasury;
        if (cancelledTreasury != address(0)) {
            delete pendingTreasury;
            delete pendingTreasuryAcceptAfter;
            emit TreasuryProposalInvalidated(cancelledTreasury, newOwner);
        }
        super._transferOwnership(newOwner);
    }

    function _sendNative(address recipient, uint256 amount) private {
        (bool success,) = payable(recipient).call{value: amount}("");
        if (!success) revert NativeTransferFailed();
    }
}
