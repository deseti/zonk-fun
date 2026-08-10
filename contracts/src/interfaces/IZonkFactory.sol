// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IZonkFactory {
    enum LaunchState {
        Created
    }

    struct TokenInfo {
        address creator;
        LaunchState launchState;
    }

    error DuplicateToken();
    error InvalidInitialSupply();
    error InvalidTokenName();
    error InvalidTokenSymbol();

    event TokenCreated(
        address indexed token, address indexed creator, string name, string symbol, uint256 initialSupply
    );

    function createToken(string calldata name, string calldata symbol, uint256 initialSupply)
        external
        returns (address token);

    function isToken(address token) external view returns (bool);

    function tokenInfo(address token) external view returns (address creator, LaunchState launchState);

    function definitionToken(bytes32 definitionId) external view returns (address);

    function tokensByCreator(address creator) external view returns (address[] memory);
}
