// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ILPLocker {
    struct Lock {
        address liquidityToken;
        address beneficiary;
        uint256 amount;
        uint64 unlockTimestamp;
    }

    error AlreadyClaimed();
    error InvalidAmount();
    error InvalidBeneficiary();
    error InvalidLiquidityManager();
    error InvalidLiquidityToken();
    error InvalidTransferAmount();
    error InvalidUnlockTimestamp();
    error LockNotFound();
    error LockNotMature();
    error UnauthorizedBeneficiary();
    error UnauthorizedLiquidityManager();

    event LiquidityLocked(
        uint256 indexed lockId,
        address indexed liquidityToken,
        address indexed beneficiary,
        uint256 amount,
        uint64 unlockTimestamp
    );
    event LiquidityClaimed(
        uint256 indexed lockId, address indexed liquidityToken, address indexed beneficiary, uint256 amount
    );

    function liquidityManager() external view returns (address);

    function nextLockId() external view returns (uint256);

    function lock(uint256 lockId) external view returns (Lock memory lockState);

    function lockLiquidity(address liquidityToken, uint256 amount, address beneficiary, uint64 unlockTimestamp)
        external
        returns (uint256 lockId);

    function claim(uint256 lockId) external returns (uint256 amount);
}
