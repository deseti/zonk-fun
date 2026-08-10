// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IZonkToken {
    error AlreadyInitialized();
    error InvalidCreator();
    error InvalidFactory();
    error InvalidInitialSupply();
    error InvalidTokenName();
    error InvalidTokenSymbol();
    error OnlyFactory();

    function initialize(address creator, uint256 initialSupply) external;

    function factory() external view returns (address);

    function creator() external view returns (address);

    function initialSupply() external view returns (uint256);

    function initialized() external view returns (bool);
}
