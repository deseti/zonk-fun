// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Constants shared by the Phase 1 token and Phase 2 curve contracts.
library ZonkConstants {
    uint256 internal constant MAX_TOKEN_NAME_LENGTH = 64;
    uint256 internal constant MAX_TOKEN_SYMBOL_LENGTH = 16;
    uint8 internal constant TOKEN_DECIMALS = 18;

    uint256 internal constant FEE_DENOMINATOR = 10_000;
    uint256 internal constant PROTOCOL_FEE_BPS = 100;
    uint256 internal constant CREATOR_FEE_BPS = 100;
    uint256 internal constant MIN_TRADE_AMOUNT = 1;
    uint256 internal constant MAX_CURVE_SUPPLY = 1_000_000_000 ether;
    uint256 internal constant MAX_TRADE_AMOUNT = MAX_CURVE_SUPPLY;
    // With MAX_CURVE_SUPPLY, these caps keep every intermediate CurveMath result
    // well within uint256 while still allowing high-value valid curve parameters.
    uint256 internal constant MAX_STARTING_PRICE = 1e30;
    uint256 internal constant MAX_SLOPE = 1e30;
}
