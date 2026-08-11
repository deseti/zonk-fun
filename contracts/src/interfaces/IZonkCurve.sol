// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IFeeManager} from "./IFeeManager.sol";
import {ILiquidityManager} from "./ILiquidityManager.sol";

interface IZonkCurve {
    enum Lifecycle {
        Active,
        GraduationPending,
        Graduated
    }

    struct Curve {
        address token;
        address creator;
        uint256 curveSupply;
        uint256 soldSupply;
        uint256 reserveBalance;
        uint256 startingPrice;
        uint256 slope;
        uint256 graduationThreshold;
        Lifecycle lifecycle;
    }

    error AlreadyGraduated();
    error CurveAlreadyExists();
    error CurveNotFound();
    error InsufficientCurveInventory();
    error InsufficientMsgValue();
    error InsufficientReserve();
    error InvalidAmount();
    error InvalidCurveParameters();
    error InvalidFactory();
    error InvalidFeeManager();
    error InvalidLiquidityManager();
    error InvalidRecipient();
    error NativeTransferFailed();
    error OnlyTokenCreator();
    error GraduationAccountingMismatch();
    error GraduationNotPending();
    error GraduationThresholdExceeded();
    error InsufficientGraduationLiquidity();
    error SlippageExceeded();
    error TokenNotRegistered();
    error TradingNotActive(Lifecycle lifecycle);
    error UnauthorizedGraduation();
    error TokenTransferFailed();
    error UnexpectedEther();

    event CurveCreated(
        address indexed token,
        address indexed creator,
        uint256 curveSupply,
        uint256 startingPrice,
        uint256 slope,
        uint256 graduationThreshold
    );

    event TokensBought(
        address indexed token,
        address indexed buyer,
        uint256 tokenAmount,
        uint256 reserveIn,
        uint256 curveCost,
        uint256 protocolFee,
        uint256 creatorFee
    );

    event TokensSold(
        address indexed token,
        address indexed seller,
        uint256 tokenAmount,
        uint256 reserveOut,
        uint256 curveValue,
        uint256 protocolFee,
        uint256 creatorFee
    );

    event GraduationPending(
        address indexed token, uint256 soldSupply, uint256 reserveBalance, uint256 tokenLiquidityAmount
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

    function createCurve(
        address token,
        uint256 curveSupply,
        uint256 startingPrice,
        uint256 slope,
        uint256 graduationThreshold
    ) external returns (Curve memory curveState);

    function curve(address token) external view returns (Curve memory curveState);

    function feeManager() external view returns (IFeeManager);

    function liquidityManager() external view returns (ILiquidityManager);

    function quoteGraduation(address token) external view returns (uint256 tokenAmount, uint256 quoteAmount);

    function quoteBuy(address token, uint256 tokenAmount)
        external
        view
        returns (uint256 reserveIn, uint256 curveCost, uint256 protocolFee, uint256 creatorFee);

    function quoteSell(address token, uint256 tokenAmount)
        external
        view
        returns (uint256 reserveOut, uint256 curveValue, uint256 protocolFee, uint256 creatorFee);

    function buy(address token, uint256 tokenAmount, uint256 maxReserveIn) external payable returns (uint256 reserveIn);

    function sell(address token, uint256 tokenAmount, uint256 minReserveOut) external returns (uint256 reserveOut);

    function graduate(address token, uint256 deadline)
        external
        returns (ILiquidityManager.GraduationRecord memory record);
}
