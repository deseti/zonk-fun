// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IZonkToken} from "./interfaces/IZonkToken.sol";
import {ZonkConstants} from "./libraries/ZonkConstants.sol";

/// @notice Fixed-supply ERC-20 created and initialized by ZonkFactory.
contract ZonkToken is ERC20, IZonkToken {
    address public immutable override factory;
    address public override creator;
    uint256 public override initialSupply;
    bool public override initialized;

    constructor(address factory_, string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        if (factory_ == address(0)) revert InvalidFactory();
        if (bytes(name_).length == 0 || bytes(name_).length > ZonkConstants.MAX_TOKEN_NAME_LENGTH) {
            revert InvalidTokenName();
        }
        if (bytes(symbol_).length == 0 || bytes(symbol_).length > ZonkConstants.MAX_TOKEN_SYMBOL_LENGTH) {
            revert InvalidTokenSymbol();
        }

        factory = factory_;
    }

    /// @notice Mint the fixed initial supply to the creator exactly once.
    /// @dev No public or post-initialization mint function exists.
    function initialize(address creator_, uint256 initialSupply_) external override {
        if (msg.sender != factory) revert OnlyFactory();
        if (initialized) revert AlreadyInitialized();
        if (creator_ == address(0)) revert InvalidCreator();
        if (initialSupply_ == 0) revert InvalidInitialSupply();

        initialized = true;
        creator = creator_;
        initialSupply = initialSupply_;
        _mint(creator_, initialSupply_);
    }

    function decimals() public pure override returns (uint8) {
        return ZonkConstants.TOKEN_DECIMALS;
    }
}
