// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPermanentLPFeeVaultV3 {
    error CustodianDeployerAlreadySet();
    error InsufficientLPFeeBacking(address asset, uint256 available, uint256 required);
    error InvalidCustodianDeployer();
    error InvalidLPFeeAsset();
    error NothingToClaimLPFees();
    error UnauthorizedBootstrap();
    error UnauthorizedPermanentCustodian();

    event PermanentLPCustodianDeployerSet(address indexed deployer);
    event PermanentLPFeesAccrued(
        address indexed launchToken,
        address indexed custodian,
        address indexed asset,
        address protocolRecipient,
        address creatorRecipient,
        uint256 protocolShare,
        uint256 creatorShare
    );
    event ProtocolLPFeesClaimed(address indexed recipient, address indexed asset, uint256 amount);
    event CreatorLPFeesClaimed(address indexed recipient, address indexed asset, uint256 amount);

    function setPermanentLPCustodianDeployerOnce(address deployer) external;
    function notifyPermanentLPFees(address launchToken, uint256 amount0, uint256 amount1) external;
    function claimLPFees(address asset) external returns (uint256 protocolAmount, uint256 creatorAmount);

    function protocolVersionHash() external pure returns (bytes32);
    function factory() external view returns (address);
    function feeManager() external view returns (address);
    function graduationManager() external view returns (address);
    function weth() external view returns (address);
    function permanentLPCustodianDeployer() external view returns (address);
    function custodianDeployerBootstrapAuthority() external view returns (address);
    function protocolLPFeesAccrued(address recipient, address asset) external view returns (uint256);
    function creatorLPFeesAccrued(address recipient, address asset) external view returns (uint256);
    function totalLPFeesAccrued(address asset) external view returns (uint256);
}
