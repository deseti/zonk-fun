// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDEXAdapter} from "../../src/interfaces/IDEXAdapter.sol";

contract MockLiquidityToken is ERC20 {
    address internal immutable minter;

    constructor(address minter_) ERC20("Mock Locked Liquidity", "MLP") {
        minter = minter_;
    }

    function mint(address recipient, uint256 amount) external {
        require(msg.sender == minter, "only minter");
        _mint(recipient, amount);
    }
}

contract MockDEXAdapter is IDEXAdapter {
    using SafeERC20 for IERC20;

    enum Behavior {
        Success,
        RevertCall,
        ReturnZeroLiquidity,
        PartialUse,
        SkipLPTransfer
    }

    mapping(address token => address liquidityAsset) internal _liquidityTokens;
    Behavior public behavior;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackAttempted;
    bool public callbackSucceeded;

    function configureToken(address token) external returns (address liquidityAsset) {
        liquidityAsset = address(new MockLiquidityToken(address(this)));
        _liquidityTokens[token] = liquidityAsset;
    }

    function setLiquidityToken(address token, address liquidityAsset) external {
        _liquidityTokens[token] = liquidityAsset;
    }

    function setBehavior(Behavior behavior_) external {
        behavior = behavior_;
    }

    function setCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function liquidityToken(address token) external view returns (address) {
        return _liquidityTokens[token];
    }

    function addLiquidity(
        address token,
        uint256 tokenDesired,
        uint256 quoteDesired,
        uint256 tokenMinimum,
        uint256 quoteMinimum,
        address recipient,
        uint256 deadline
    ) external payable returns (uint256 tokenUsed, uint256 quoteUsed, uint256 liquidityMinted) {
        require(block.timestamp <= deadline, "deadline");
        require(msg.value == quoteDesired, "quote value");
        if (behavior == Behavior.RevertCall) revert("adapter failure");

        if (callbackTarget != address(0)) {
            callbackAttempted = true;
            (callbackSucceeded,) = callbackTarget.call(callbackData);
        }

        tokenUsed = behavior == Behavior.PartialUse ? tokenMinimum : tokenDesired;
        quoteUsed = behavior == Behavior.PartialUse ? quoteMinimum : quoteDesired;
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenUsed);
        if (quoteUsed < quoteDesired) {
            (bool refunded,) = payable(msg.sender).call{value: quoteDesired - quoteUsed}("");
            require(refunded, "refund failed");
        }

        if (behavior == Behavior.ReturnZeroLiquidity) return (tokenUsed, quoteUsed, 0);
        liquidityMinted = tokenUsed;
        if (behavior != Behavior.SkipLPTransfer) {
            MockLiquidityToken(_liquidityTokens[token]).mint(recipient, liquidityMinted);
        }
    }
}

contract TransferTaxToken is ERC20 {
    constructor() ERC20("Transfer Tax", "TAX") {
        _mint(msg.sender, 1_000 ether);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && value > 1) {
            super._update(from, to, value - 1);
            super._update(from, address(0), 1);
        } else {
            super._update(from, to, value);
        }
    }
}
