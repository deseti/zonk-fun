// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice DEX-neutral boundary for creating token/native-asset liquidity.
/// @dev An adapter must normalize its position into a transferable ERC-20
/// liquidity receipt so LiquidityManager can verify and lock custody on-chain.
interface IDEXAdapter {
    function liquidityToken(address token) external view returns (address);

    function addLiquidity(
        address token,
        uint256 tokenDesired,
        uint256 quoteDesired,
        uint256 tokenMinimum,
        uint256 quoteMinimum,
        address recipient,
        uint256 deadline
    ) external payable returns (uint256 tokenUsed, uint256 quoteUsed, uint256 liquidityMinted);
}
