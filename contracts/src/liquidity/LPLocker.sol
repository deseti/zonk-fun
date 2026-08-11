// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ILPLocker} from "../interfaces/ILPLocker.sol";

/// @notice Minimal non-custodial timelock for fungible DEX liquidity receipts.
contract LPLocker is ILPLocker, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable override liquidityManager;
    uint256 public override nextLockId = 1;

    mapping(uint256 lockId => Lock lockState) private _locks;

    constructor(address liquidityManager_) {
        if (liquidityManager_ == address(0)) revert InvalidLiquidityManager();
        liquidityManager = liquidityManager_;
    }

    function lock(uint256 lockId) external view override returns (Lock memory lockState) {
        lockState = _locks[lockId];
        if (lockState.liquidityToken == address(0)) revert LockNotFound();
    }

    function lockLiquidity(address liquidityToken, uint256 amount, address beneficiary, uint64 unlockTimestamp)
        external
        override
        nonReentrant
        returns (uint256 lockId)
    {
        if (msg.sender != liquidityManager) revert UnauthorizedLiquidityManager();
        if (liquidityToken == address(0) || liquidityToken.code.length == 0) revert InvalidLiquidityToken();
        if (beneficiary == address(0)) revert InvalidBeneficiary();
        if (amount == 0) revert InvalidAmount();
        if (unlockTimestamp <= block.timestamp) revert InvalidUnlockTimestamp();

        IERC20 asset = IERC20(liquidityToken);
        uint256 balanceBefore = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), amount);
        if (asset.balanceOf(address(this)) - balanceBefore != amount) revert InvalidTransferAmount();

        lockId = nextLockId++;
        _locks[lockId] = Lock({
            liquidityToken: liquidityToken, beneficiary: beneficiary, amount: amount, unlockTimestamp: unlockTimestamp
        });
        emit LiquidityLocked(lockId, liquidityToken, beneficiary, amount, unlockTimestamp);
    }

    function claim(uint256 lockId) external override nonReentrant returns (uint256 amount) {
        Lock storage lockState = _locks[lockId];
        if (lockState.liquidityToken == address(0)) revert LockNotFound();
        if (msg.sender != lockState.beneficiary) revert UnauthorizedBeneficiary();
        if (block.timestamp < lockState.unlockTimestamp) revert LockNotMature();
        amount = lockState.amount;
        if (amount == 0) revert AlreadyClaimed();

        lockState.amount = 0;
        IERC20 asset = IERC20(lockState.liquidityToken);
        uint256 balanceBefore = asset.balanceOf(address(this));
        asset.safeTransfer(msg.sender, amount);
        if (balanceBefore - asset.balanceOf(address(this)) != amount) revert InvalidTransferAmount();
        emit LiquidityClaimed(lockId, lockState.liquidityToken, msg.sender, amount);
    }
}
