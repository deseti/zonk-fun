// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IZonkFactory} from "./interfaces/IZonkFactory.sol";
import {ZonkConstants} from "./libraries/ZonkConstants.sol";
import {ZonkToken} from "./ZonkToken.sol";

/// @notice Permissionless factory and registry for fixed-supply Zonk tokens.
contract ZonkFactory is IZonkFactory {
    mapping(address token => TokenInfo info) public override tokenInfo;
    mapping(address token => bool) public override isToken;
    mapping(bytes32 definitionId => address token) public override definitionToken;
    mapping(address creator => address[] tokens) private _tokensByCreator;

    function createToken(string calldata name, string calldata symbol, uint256 initialSupply)
        external
        override
        returns (address token)
    {
        _validateTokenParameters(name, symbol, initialSupply);

        bytes32 definitionId = keccak256(abi.encode(msg.sender, name, symbol, initialSupply));
        if (definitionToken[definitionId] != address(0)) revert DuplicateToken();

        ZonkToken createdToken = new ZonkToken(address(this), name, symbol);
        createdToken.initialize(msg.sender, initialSupply);
        token = address(createdToken);

        definitionToken[definitionId] = token;
        isToken[token] = true;
        tokenInfo[token] = TokenInfo({creator: msg.sender, launchState: LaunchState.Created});
        _tokensByCreator[msg.sender].push(token);

        emit TokenCreated(token, msg.sender, name, symbol, initialSupply);
    }

    function tokensByCreator(address creator) external view override returns (address[] memory) {
        return _tokensByCreator[creator];
    }

    function _validateTokenParameters(string calldata name, string calldata symbol, uint256 initialSupply)
        private
        pure
    {
        if (bytes(name).length == 0 || bytes(name).length > ZonkConstants.MAX_TOKEN_NAME_LENGTH) {
            revert InvalidTokenName();
        }
        if (bytes(symbol).length == 0 || bytes(symbol).length > ZonkConstants.MAX_TOKEN_SYMBOL_LENGTH) {
            revert InvalidTokenSymbol();
        }
        if (initialSupply == 0) revert InvalidInitialSupply();
    }
}
