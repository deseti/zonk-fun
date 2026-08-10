// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IZonkCurve} from "./interfaces/IZonkCurve.sol";
import {IZonkFactory} from "./interfaces/IZonkFactory.sol";
import {CurveMath} from "./libraries/CurveMath.sol";
import {ZonkConstants} from "./libraries/ZonkConstants.sol";
import {ZonkToken} from "./ZonkToken.sol";

/// @notice Native-ETH linear bonding curves for fixed-supply Zonk tokens.
///
/// A curve escrows a creator-selected token allocation. It never mints or burns:
/// buys transfer escrowed tokens to traders and sells transfer them back. The
/// tracked reserve contains only the curve value of completed trades; protocol
/// and creator fees are paid out separately and exactly once.
///
/// Economic parameters:
/// - Reserve denomination: native ETH, tracked in `reserveBalance`.
/// - Token amounts: 18-decimal ZonkToken base units; `curveSupply` is fixed escrow.
/// - Price: `P(q) = startingPrice + slope * q / 1e18`, in wei per whole token.
/// - Starting price and slope are set per curve, must be nonzero, and are each
///   capped at `1e30` to keep all accepted CurveMath intermediates safe.
/// - Protocol and creator fees are each 100 bps of curve value (2% total).
/// - Buy fees round up; sell fees round down. This prevents buyer underpayment and
///   seller overpayment while keeping fees accounted for once.
/// - Graduation occurs when sold supply reaches `graduationThreshold`; all later
///   buys and sells revert because external liquidity migration is out of scope.
/// - Trades are at least one base unit and at most `MAX_TRADE_AMOUNT`.
contract ZonkCurve is IZonkCurve, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant PROTOCOL_FEE_BPS = ZonkConstants.PROTOCOL_FEE_BPS;
    uint256 public constant CREATOR_FEE_BPS = ZonkConstants.CREATOR_FEE_BPS;
    uint256 public constant FEE_DENOMINATOR = ZonkConstants.FEE_DENOMINATOR;
    uint256 public constant MIN_TRADE_AMOUNT = ZonkConstants.MIN_TRADE_AMOUNT;
    uint256 public constant MAX_TRADE_AMOUNT = ZonkConstants.MAX_TRADE_AMOUNT;
    uint256 public constant MAX_STARTING_PRICE = ZonkConstants.MAX_STARTING_PRICE;
    uint256 public constant MAX_SLOPE = ZonkConstants.MAX_SLOPE;

    IZonkFactory public immutable factory;
    address public immutable protocolFeeRecipient;

    mapping(address token => Curve curveState) private _curves;

    constructor(address factory_, address protocolFeeRecipient_) {
        if (factory_ == address(0)) revert InvalidFactory();
        if (protocolFeeRecipient_ == address(0)) revert InvalidProtocolRecipient();
        factory = IZonkFactory(factory_);
        protocolFeeRecipient = protocolFeeRecipient_;
    }

    function createCurve(
        address token,
        uint256 curveSupply,
        uint256 startingPrice,
        uint256 slope,
        uint256 graduationThreshold
    ) external nonReentrant returns (Curve memory curveState) {
        if (!factory.isToken(token)) revert TokenNotRegistered();
        address creator = ZonkToken(token).creator();
        if (msg.sender != creator) revert OnlyTokenCreator();
        if (_curves[token].token != address(0)) revert CurveAlreadyExists();
        if (curveSupply == 0 || curveSupply > ZonkConstants.MAX_CURVE_SUPPLY) {
            revert InvalidCurveParameters();
        }
        if (
            startingPrice == 0 || startingPrice > ZonkConstants.MAX_STARTING_PRICE || slope == 0
                || slope > ZonkConstants.MAX_SLOPE || graduationThreshold == 0 || graduationThreshold > curveSupply
        ) {
            revert InvalidCurveParameters();
        }
        if (curveSupply > IERC20(token).totalSupply()) revert InvalidCurveParameters();

        IERC20(token).safeTransferFrom(msg.sender, address(this), curveSupply);

        curveState = Curve({
            token: token,
            creator: creator,
            curveSupply: curveSupply,
            soldSupply: 0,
            reserveBalance: 0,
            startingPrice: startingPrice,
            slope: slope,
            graduationThreshold: graduationThreshold,
            graduated: false
        });
        _curves[token] = curveState;

        emit CurveCreated(token, creator, curveSupply, startingPrice, slope, graduationThreshold);
    }

    function curve(address token) external view returns (Curve memory curveState) {
        curveState = _getCurve(token);
    }

    function quoteBuy(address token, uint256 tokenAmount)
        public
        view
        returns (uint256 reserveIn, uint256 curveCost, uint256 protocolFee, uint256 creatorFee)
    {
        Curve memory curveState = _getCurve(token);
        _validateActiveTrade(curveState);
        _validateTradeAmount(tokenAmount);
        if (tokenAmount > curveState.curveSupply - curveState.soldSupply) revert InsufficientCurveInventory();

        curveCost = CurveMath.buyCost(curveState.startingPrice, curveState.slope, curveState.soldSupply, tokenAmount);
        protocolFee = CurveMath.protocolFee(curveCost);
        creatorFee = CurveMath.creatorFee(curveCost);
        reserveIn = curveCost + protocolFee + creatorFee;
    }

    function quoteSell(address token, uint256 tokenAmount)
        public
        view
        returns (uint256 reserveOut, uint256 curveValue, uint256 protocolFee, uint256 creatorFee)
    {
        Curve memory curveState = _getCurve(token);
        _validateActiveTrade(curveState);
        _validateTradeAmount(tokenAmount);
        if (tokenAmount > curveState.soldSupply) revert InvalidAmount();

        curveValue = CurveMath.sellValue(curveState.startingPrice, curveState.slope, curveState.soldSupply, tokenAmount);
        if (curveValue > curveState.reserveBalance) revert InsufficientReserve();
        protocolFee = CurveMath.protocolFeeOnSell(curveValue);
        creatorFee = CurveMath.creatorFeeOnSell(curveValue);
        reserveOut = curveValue - protocolFee - creatorFee;
    }

    function buy(address token, uint256 tokenAmount, uint256 maxReserveIn)
        external
        payable
        nonReentrant
        returns (uint256 reserveIn)
    {
        uint256 curveCost;
        uint256 protocolFee;
        uint256 creatorFee;
        (reserveIn, curveCost, protocolFee, creatorFee) = quoteBuy(token, tokenAmount);
        if (reserveIn > maxReserveIn) revert SlippageExceeded();
        if (msg.value < reserveIn) revert InsufficientMsgValue();

        Curve storage curveState = _curves[token];
        curveState.reserveBalance += curveCost;
        curveState.soldSupply += tokenAmount;

        IERC20(token).safeTransfer(msg.sender, tokenAmount);
        _sendNative(protocolFeeRecipient, protocolFee);
        _sendNative(curveState.creator, creatorFee);

        uint256 refund = msg.value - reserveIn;
        if (refund != 0) _sendNative(msg.sender, refund);

        emit TokensBought(token, msg.sender, tokenAmount, reserveIn, curveCost, protocolFee, creatorFee);
        _markGraduated(curveState);
    }

    function sell(address token, uint256 tokenAmount, uint256 minReserveOut)
        external
        nonReentrant
        returns (uint256 reserveOut)
    {
        uint256 curveValue;
        uint256 protocolFee;
        uint256 creatorFee;
        (reserveOut, curveValue, protocolFee, creatorFee) = quoteSell(token, tokenAmount);
        if (reserveOut < minReserveOut) revert SlippageExceeded();

        Curve storage curveState = _curves[token];
        if (curveValue > curveState.reserveBalance) revert InsufficientReserve();
        curveState.reserveBalance -= curveValue;
        curveState.soldSupply -= tokenAmount;

        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenAmount);
        _sendNative(msg.sender, reserveOut);
        _sendNative(protocolFeeRecipient, protocolFee);
        _sendNative(curveState.creator, creatorFee);

        emit TokensSold(token, msg.sender, tokenAmount, reserveOut, curveValue, protocolFee, creatorFee);
    }

    receive() external payable {
        revert UnexpectedEther();
    }

    function _getCurve(address token) private view returns (Curve memory curveState) {
        curveState = _curves[token];
        if (curveState.token == address(0)) revert CurveNotFound();
    }

    function _validateActiveTrade(Curve memory curveState) private pure {
        if (curveState.graduated) revert AlreadyGraduated();
    }

    function _validateTradeAmount(uint256 tokenAmount) private pure {
        if (tokenAmount < ZonkConstants.MIN_TRADE_AMOUNT || tokenAmount > ZonkConstants.MAX_TRADE_AMOUNT) {
            revert InvalidAmount();
        }
    }

    function _markGraduated(Curve storage curveState) private {
        if (curveState.soldSupply >= curveState.graduationThreshold && !curveState.graduated) {
            curveState.graduated = true;
            emit Graduated(curveState.token, curveState.soldSupply, curveState.reserveBalance);
        }
    }

    function _sendNative(address recipient, uint256 amount) private {
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) return;
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert FeeTransferFailed();
    }
}
