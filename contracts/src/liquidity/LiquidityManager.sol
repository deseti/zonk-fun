// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IDEXAdapter} from "../interfaces/IDEXAdapter.sol";
import {ILiquidityManager} from "../interfaces/ILiquidityManager.sol";
import {ILPLocker} from "../interfaces/ILPLocker.sol";
import {LPLocker} from "./LPLocker.sol";
import {ZonkConstants} from "../libraries/ZonkConstants.sol";

/// @notice Atomic graduation coordinator and DEX-neutral liquidity custodian.
/// @dev Active curve reserves never reside here. A successful call consumes the
/// exact token/native-asset amounts and locks the exact LP receipt atomically.
contract LiquidityManager is ILiquidityManager, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct AdapterExecution {
        uint256 tokenBalanceBefore;
        uint256 liquidityBalanceBefore;
        uint256 quoteBalanceBefore;
        uint256 tokenUsed;
        uint256 quoteUsed;
        uint256 liquidityMinted;
    }

    bytes32 public constant CURVE_ROLE = keccak256("CURVE_ROLE");
    bytes32 public constant GRADUATION_EXECUTOR_ROLE = keccak256("GRADUATION_EXECUTOR_ROLE");

    IDEXAdapter public override dexAdapter;
    bool public override adapterConfigured;
    ILPLocker public immutable override lpLocker;
    address public immutable override lpBeneficiary;
    uint64 public immutable override lockDuration;
    uint16 public immutable override maxSlippageBps;

    mapping(address token => address curve) public override curveOf;
    mapping(address token => address creator) public override creatorOf;
    mapping(address token => bool executed) public override graduationExecuted;
    mapping(address token => GraduationRecord record) private _graduations;

    constructor(address governance, address lpBeneficiary_, uint64 lockDuration_, uint16 maxSlippageBps_) {
        if (governance == address(0)) revert InvalidGraduationExecutor();
        if (lpBeneficiary_ == address(0)) revert InvalidBeneficiary();
        if (lockDuration_ < ZonkConstants.MIN_LP_LOCK_DURATION || lockDuration_ > ZonkConstants.MAX_LP_LOCK_DURATION) {
            revert InvalidLockDuration();
        }
        if (maxSlippageBps_ > ZonkConstants.MAX_LIQUIDITY_SLIPPAGE_BPS) revert InvalidSlippage();

        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(GRADUATION_EXECUTOR_ROLE, governance);
        lpBeneficiary = lpBeneficiary_;
        lockDuration = lockDuration_;
        maxSlippageBps = maxSlippageBps_;
        lpLocker = ILPLocker(address(new LPLocker(address(this))));
    }

    function graduation(address token) external view override returns (GraduationRecord memory record) {
        record = _graduations[token];
    }

    function isGraduationExecutor(address account) external view override returns (bool) {
        return hasRole(GRADUATION_EXECUTOR_ROLE, account);
    }

    function configureDexAdapter(address dexAdapter_) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (adapterConfigured) revert AdapterAlreadyConfigured();
        if (dexAdapter_ == address(0) || dexAdapter_.code.length == 0) revert InvalidAdapter();
        dexAdapter = IDEXAdapter(dexAdapter_);
        adapterConfigured = true;
        emit DexAdapterConfigured(dexAdapter_, msg.sender);
    }

    function registerToken(address token, address creator) external override onlyRole(CURVE_ROLE) {
        if (msg.sender.code.length == 0) revert InvalidCurve();
        if (token == address(0) || token.code.length == 0) revert InvalidToken();
        if (creator == address(0)) revert InvalidCreator();
        if (curveOf[token] != address(0)) revert TokenAlreadyRegistered();
        curveOf[token] = msg.sender;
        creatorOf[token] = creator;
        emit TokenLiquidityRegistered(token, msg.sender, creator);
    }

    function createLiquidity(address token, uint256 tokenAmount, uint256 quoteAmount, uint256 deadline)
        external
        payable
        override
        onlyRole(CURVE_ROLE)
        nonReentrant
        returns (GraduationRecord memory record)
    {
        if (curveOf[token] != msg.sender) revert UnauthorizedCurve();
        if (!adapterConfigured) revert AdapterNotConfigured();
        if (graduationExecuted[token]) revert GraduationAlreadyExecuted();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (tokenAmount == 0 || quoteAmount == 0) revert InsufficientLiquidity();
        if (msg.value != quoteAmount) revert InvalidQuoteValue();

        address liquidityToken = dexAdapter.liquidityToken(token);
        if (liquidityToken == address(0) || liquidityToken == token || liquidityToken.code.length == 0) {
            revert InvalidLiquidityToken();
        }

        graduationExecuted[token] = true;
        IERC20 liquidityAsset = IERC20(liquidityToken);
        uint256 liquidityMinted = _executeAdapter(token, liquidityToken, tokenAmount, quoteAmount, deadline);

        uint64 unlockTimestamp = uint64(block.timestamp) + lockDuration;
        liquidityAsset.forceApprove(address(lpLocker), liquidityMinted);
        uint256 lockId = lpLocker.lockLiquidity(liquidityToken, liquidityMinted, lpBeneficiary, unlockTimestamp);
        liquidityAsset.forceApprove(address(lpLocker), 0);

        record = GraduationRecord({
            curve: msg.sender,
            creator: creatorOf[token],
            liquidityToken: liquidityToken,
            tokenAmount: tokenAmount,
            quoteAmount: quoteAmount,
            liquidityAmount: liquidityMinted,
            lockId: lockId,
            executedAt: uint64(block.timestamp),
            unlockTimestamp: unlockTimestamp
        });
        _graduations[token] = record;
        emit LiquidityCreated(
            token, msg.sender, liquidityToken, tokenAmount, quoteAmount, liquidityMinted, lockId, unlockTimestamp
        );
    }

    receive() external payable {
        if (!adapterConfigured || msg.sender != address(dexAdapter)) revert UnexpectedEther();
    }

    function _minimumAmount(uint256 desiredAmount) private view returns (uint256) {
        return Math.mulDiv(
            desiredAmount,
            ZonkConstants.FEE_DENOMINATOR - maxSlippageBps,
            ZonkConstants.FEE_DENOMINATOR,
            Math.Rounding.Ceil
        );
    }

    function _executeAdapter(
        address token,
        address liquidityToken,
        uint256 tokenAmount,
        uint256 quoteAmount,
        uint256 deadline
    ) private returns (uint256 liquidityMinted) {
        IERC20 launchToken = IERC20(token);
        IERC20 liquidityAsset = IERC20(liquidityToken);
        AdapterExecution memory execution;
        execution.tokenBalanceBefore = launchToken.balanceOf(address(this));
        launchToken.safeTransferFrom(msg.sender, address(this), tokenAmount);
        if (launchToken.balanceOf(address(this)) - execution.tokenBalanceBefore != tokenAmount) {
            revert InvalidLiquidityAccounting();
        }

        execution.liquidityBalanceBefore = liquidityAsset.balanceOf(address(this));
        execution.quoteBalanceBefore = address(this).balance;
        launchToken.forceApprove(address(dexAdapter), tokenAmount);
        (execution.tokenUsed, execution.quoteUsed, execution.liquidityMinted) = dexAdapter.addLiquidity{
            value: quoteAmount
        }(
            token,
            tokenAmount,
            quoteAmount,
            _minimumAmount(tokenAmount),
            _minimumAmount(quoteAmount),
            address(this),
            deadline
        );
        launchToken.forceApprove(address(dexAdapter), 0);

        uint256 tokenSpent = execution.tokenBalanceBefore + tokenAmount - launchToken.balanceOf(address(this));
        uint256 quoteSpent = execution.quoteBalanceBefore - address(this).balance;
        uint256 liquidityReceived = liquidityAsset.balanceOf(address(this)) - execution.liquidityBalanceBefore;
        if (
            execution.tokenUsed != tokenAmount || execution.quoteUsed != quoteAmount || tokenSpent != tokenAmount
                || quoteSpent != quoteAmount || execution.liquidityMinted == 0
                || liquidityReceived != execution.liquidityMinted
        ) {
            revert InvalidLiquidityAccounting();
        }
        liquidityMinted = execution.liquidityMinted;
    }
}
