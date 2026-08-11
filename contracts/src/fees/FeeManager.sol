// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IFeeManager} from "../interfaces/IFeeManager.sol";
import {ZonkConstants} from "../libraries/ZonkConstants.sol";

/// @notice On-chain fee policy and isolated pull-payment ledger for Zonk curves.
/// @dev Trading reserves never enter this contract. Only fees calculated under
/// the active capped configuration may be accrued by the registered curve.
contract FeeManager is IFeeManager, AccessControl, ReentrancyGuard {
    bytes32 public constant FEE_CONFIG_ROLE = keccak256("FEE_CONFIG_ROLE");
    bytes32 public constant CURVE_ROLE = keccak256("CURVE_ROLE");

    uint256 public constant FEE_DENOMINATOR = ZonkConstants.FEE_DENOMINATOR;
    uint256 public constant MAX_PROTOCOL_FEE_BPS = ZonkConstants.MAX_PROTOCOL_FEE_BPS;
    uint256 public constant MAX_CREATOR_FEE_BPS = ZonkConstants.MAX_CREATOR_FEE_BPS;
    uint256 public constant MAX_TOTAL_FEE_BPS = ZonkConstants.MAX_TOTAL_FEE_BPS;

    address public override treasury;
    uint16 public override protocolFeeBps;
    uint16 public override creatorFeeBps;

    mapping(address token => address curve) public override curveOf;
    mapping(address token => address creator) public override creatorOf;
    mapping(address token => uint256 amount) public override creatorFeesAccrued;

    uint256 public override protocolFeesAccrued;
    uint256 public override totalCreatorFeesAccrued;

    constructor(address governance, address treasury_, uint16 initialProtocolFeeBps, uint16 initialCreatorFeeBps) {
        if (governance == address(0)) revert InvalidGovernance();
        if (treasury_ == address(0)) revert InvalidTreasury();

        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(FEE_CONFIG_ROLE, governance);
        treasury = treasury_;
        _setFeeConfiguration(initialProtocolFeeBps, initialCreatorFeeBps);

        emit TreasuryUpdated(address(0), treasury_, msg.sender);
    }

    function setFeeConfiguration(uint16 protocolFeeBps_, uint16 creatorFeeBps_)
        external
        override
        onlyRole(FEE_CONFIG_ROLE)
    {
        _setFeeConfiguration(protocolFeeBps_, creatorFeeBps_);
    }

    function setTreasury(address newTreasury) external override onlyRole(FEE_CONFIG_ROLE) {
        if (newTreasury == address(0)) revert InvalidTreasury();
        address previousTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(previousTreasury, newTreasury, msg.sender);
    }

    function registerToken(address token, address creator) external override onlyRole(CURVE_ROLE) {
        if (token == address(0) || token.code.length == 0) revert InvalidToken();
        if (creator == address(0)) revert InvalidCreator();
        if (curveOf[token] != address(0)) revert TokenAlreadyRegistered();

        curveOf[token] = msg.sender;
        creatorOf[token] = creator;
        emit TokenFeeAccountRegistered(token, msg.sender, creator);
    }

    function calculateBuyFees(uint256 curveValue)
        public
        view
        override
        returns (uint256 protocolFee, uint256 creatorFee)
    {
        protocolFee = Math.mulDiv(curveValue, protocolFeeBps, FEE_DENOMINATOR, Math.Rounding.Ceil);
        creatorFee = Math.mulDiv(curveValue, creatorFeeBps, FEE_DENOMINATOR, Math.Rounding.Ceil);
    }

    function calculateSellFees(uint256 curveValue)
        public
        view
        override
        returns (uint256 protocolFee, uint256 creatorFee)
    {
        protocolFee = Math.mulDiv(curveValue, protocolFeeBps, FEE_DENOMINATOR, Math.Rounding.Floor);
        creatorFee = Math.mulDiv(curveValue, creatorFeeBps, FEE_DENOMINATOR, Math.Rounding.Floor);
    }

    function accrueBuyFees(address token, uint256 curveValue)
        external
        payable
        override
        onlyRole(CURVE_ROLE)
        returns (uint256 protocolFee, uint256 creatorFee)
    {
        (protocolFee, creatorFee) = calculateBuyFees(curveValue);
        _accrue(token, true, protocolFee, creatorFee);
    }

    function accrueSellFees(address token, uint256 curveValue)
        external
        payable
        override
        onlyRole(CURVE_ROLE)
        returns (uint256 protocolFee, uint256 creatorFee)
    {
        (protocolFee, creatorFee) = calculateSellFees(curveValue);
        _accrue(token, false, protocolFee, creatorFee);
    }

    function claimProtocolFees() external override nonReentrant returns (uint256 amount) {
        if (msg.sender != treasury) revert UnauthorizedTreasury();
        amount = protocolFeesAccrued;
        if (amount == 0) revert NothingToClaim();

        protocolFeesAccrued = 0;
        _sendNative(payable(msg.sender), amount);
        emit ProtocolFeesClaimed(msg.sender, amount);
    }

    function claimCreatorFees(address token) external override nonReentrant returns (uint256 amount) {
        if (msg.sender != creatorOf[token]) revert UnauthorizedCreator();
        amount = creatorFeesAccrued[token];
        if (amount == 0) revert NothingToClaim();

        creatorFeesAccrued[token] = 0;
        totalCreatorFeesAccrued -= amount;
        _sendNative(payable(msg.sender), amount);
        emit CreatorFeesClaimed(token, msg.sender, amount);
    }

    function totalLiabilities() external view override returns (uint256) {
        return protocolFeesAccrued + totalCreatorFeesAccrued;
    }

    receive() external payable {
        revert UnexpectedEther();
    }

    function _setFeeConfiguration(uint16 protocolFeeBps_, uint16 creatorFeeBps_) private {
        if (
            protocolFeeBps_ > ZonkConstants.MAX_PROTOCOL_FEE_BPS || creatorFeeBps_ > ZonkConstants.MAX_CREATOR_FEE_BPS
                || uint256(protocolFeeBps_) + uint256(creatorFeeBps_) > ZonkConstants.MAX_TOTAL_FEE_BPS
        ) {
            revert InvalidFeeConfiguration();
        }

        uint16 previousProtocolFeeBps = protocolFeeBps;
        uint16 previousCreatorFeeBps = creatorFeeBps;
        protocolFeeBps = protocolFeeBps_;
        creatorFeeBps = creatorFeeBps_;
        emit FeeConfigurationUpdated(
            previousProtocolFeeBps, previousCreatorFeeBps, protocolFeeBps_, creatorFeeBps_, msg.sender
        );
    }

    function _accrue(address token, bool isBuy, uint256 protocolFee, uint256 creatorFee) private {
        address registeredCurve = curveOf[token];
        if (registeredCurve == address(0) || registeredCurve != msg.sender) revert UnauthorizedCurve();
        if (msg.value != protocolFee + creatorFee) revert InvalidAccrualValue();

        protocolFeesAccrued += protocolFee;
        creatorFeesAccrued[token] += creatorFee;
        totalCreatorFeesAccrued += creatorFee;

        emit FeesAccrued(token, msg.sender, creatorOf[token], isBuy, protocolFee, creatorFee);
    }

    function _sendNative(address payable recipient, uint256 amount) private {
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert NativeTransferFailed();
    }
}
