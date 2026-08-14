// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Canonical endpoint-cp-v3 economic constants.
library EndpointConstantsV3 {
    string internal constant PROTOCOL_VERSION = "endpoint-cp-v3";

    uint8 internal constant TOKEN_DECIMALS = 18;
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 internal constant CURVE_ALLOCATION = 800_000_000 ether;
    uint256 internal constant LP_ALLOCATION = 200_000_000 ether;

    uint256 internal constant VIRTUAL_TOKEN_RESERVE = 1_066_666_666_666_666_666_666_666_667;
    uint256 internal constant VIRTUAL_ETH_RESERVE = 1 ether;
    uint256 internal constant GRADUATION_RESERVE = 3 ether;
    uint256 internal constant K = VIRTUAL_TOKEN_RESERVE * VIRTUAL_ETH_RESERVE;

    uint256 internal constant FEE_DENOMINATOR = 10_000;
    uint256 internal constant TOTAL_FEE_BPS = 100;
    uint256 internal constant LP_FEE_SPLIT_DENOMINATOR = 2;
    uint256 internal constant NET_GROSS_ADJUSTMENT_DENOMINATOR = (FEE_DENOMINATOR - TOTAL_FEE_BPS) / TOTAL_FEE_BPS;
    uint256 internal constant INITIAL_PRICE = 937_500_000;
    uint256 internal constant TERMINAL_PRICE = 15_000_000_000;
    uint256 internal constant EXACT_GRADUATION_GROSS = 3_030_303_030_303_030_303;

    uint256 internal constant MAX_TOKEN_NAME_LENGTH = 64;
    uint256 internal constant MAX_TOKEN_SYMBOL_LENGTH = 16;
}
