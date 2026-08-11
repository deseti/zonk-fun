// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IDEXAdapter} from "./IDEXAdapter.sol";
import {ILPLocker} from "./ILPLocker.sol";

interface ILiquidityManager {
    struct GraduationRecord {
        address curve;
        address creator;
        address liquidityToken;
        uint256 tokenAmount;
        uint256 quoteAmount;
        uint256 liquidityAmount;
        uint256 lockId;
        uint64 executedAt;
        uint64 unlockTimestamp;
    }

    error DeadlineExpired();
    error AdapterAlreadyConfigured();
    error AdapterNotConfigured();
    error GraduationAlreadyExecuted();
    error InsufficientLiquidity();
    error InvalidAdapter();
    error InvalidBeneficiary();
    error InvalidCreator();
    error InvalidCurve();
    error InvalidGraduationExecutor();
    error InvalidLiquidityAccounting();
    error InvalidLiquidityToken();
    error InvalidLockDuration();
    error InvalidQuoteValue();
    error InvalidSlippage();
    error InvalidToken();
    error TokenAlreadyRegistered();
    error UnauthorizedCurve();
    error UnexpectedEther();

    event TokenLiquidityRegistered(address indexed token, address indexed curve, address indexed creator);
    event DexAdapterConfigured(address indexed adapter, address indexed configuredBy);
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

    function dexAdapter() external view returns (IDEXAdapter);

    function adapterConfigured() external view returns (bool);

    function lpLocker() external view returns (ILPLocker);

    function lpBeneficiary() external view returns (address);

    function lockDuration() external view returns (uint64);

    function maxSlippageBps() external view returns (uint16);

    function curveOf(address token) external view returns (address);

    function creatorOf(address token) external view returns (address);

    function graduationExecuted(address token) external view returns (bool);

    function graduation(address token) external view returns (GraduationRecord memory record);

    function isGraduationExecutor(address account) external view returns (bool);

    function configureDexAdapter(address dexAdapter_) external;

    function registerToken(address token, address creator) external;

    function createLiquidity(address token, uint256 tokenAmount, uint256 quoteAmount, uint256 deadline)
        external
        payable
        returns (GraduationRecord memory record);
}
