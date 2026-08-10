// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ZonkConstants} from "./ZonkConstants.sol";

/// @notice Deterministic fixed-point math for the Phase 2 linear bonding curve.
///
/// Price at sold supply q is:
///     P(q) = startingPrice + slope * q / 1e18
///
/// For a trade of d token base units, the curve value integrates the price over
/// the interval. To avoid floating point arithmetic, the two multiplicative
/// terms are rounded separately. Buys round up, so buyers cannot underpay; sells
/// round down, so sellers cannot overdraw the reserve. Sell fees are also rounded
/// down so their sum cannot exceed a small trade's curve value.
library CurveMath {
    uint256 internal constant SCALE = 1e18;

    function buyCost(uint256 startingPrice, uint256 slope, uint256 soldSupply, uint256 tokenAmount)
        internal
        pure
        returns (uint256)
    {
        uint256 linearCost = Math.mulDiv(startingPrice, tokenAmount, SCALE, Math.Rounding.Ceil);
        uint256 slopePerAmount = Math.mulDiv(slope, tokenAmount, SCALE, Math.Rounding.Ceil);
        uint256 interval = 2 * soldSupply + tokenAmount;
        uint256 slopeCost = Math.mulDiv(slopePerAmount, interval, 2 * SCALE, Math.Rounding.Ceil);
        return linearCost + slopeCost;
    }

    function sellValue(uint256 startingPrice, uint256 slope, uint256 soldSupply, uint256 tokenAmount)
        internal
        pure
        returns (uint256)
    {
        uint256 linearValue = Math.mulDiv(startingPrice, tokenAmount, SCALE, Math.Rounding.Floor);
        uint256 slopePerAmount = Math.mulDiv(slope, tokenAmount, SCALE, Math.Rounding.Floor);
        uint256 interval = 2 * soldSupply - tokenAmount;
        uint256 slopeValue = Math.mulDiv(slopePerAmount, interval, 2 * SCALE, Math.Rounding.Floor);
        return linearValue + slopeValue;
    }

    function protocolFee(uint256 curveValue) internal pure returns (uint256) {
        return
            Math.mulDiv(curveValue, ZonkConstants.PROTOCOL_FEE_BPS, ZonkConstants.FEE_DENOMINATOR, Math.Rounding.Ceil);
    }

    function creatorFee(uint256 curveValue) internal pure returns (uint256) {
        return Math.mulDiv(curveValue, ZonkConstants.CREATOR_FEE_BPS, ZonkConstants.FEE_DENOMINATOR, Math.Rounding.Ceil);
    }

    function protocolFeeOnSell(uint256 curveValue) internal pure returns (uint256) {
        return
            Math.mulDiv(curveValue, ZonkConstants.PROTOCOL_FEE_BPS, ZonkConstants.FEE_DENOMINATOR, Math.Rounding.Floor);
    }

    function creatorFeeOnSell(uint256 curveValue) internal pure returns (uint256) {
        return
            Math.mulDiv(curveValue, ZonkConstants.CREATOR_FEE_BPS, ZonkConstants.FEE_DENOMINATOR, Math.Rounding.Floor);
    }
}
