// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IFeeManager {
    error InvalidAccrualValue();
    error InvalidCreator();
    error InvalidFeeConfiguration();
    error InvalidGovernance();
    error InvalidToken();
    error InvalidTreasury();
    error NativeTransferFailed();
    error NothingToClaim();
    error TokenAlreadyRegistered();
    error UnauthorizedCreator();
    error UnauthorizedCurve();
    error UnauthorizedTreasury();
    error UnexpectedEther();

    event FeeConfigurationUpdated(
        uint16 previousProtocolFeeBps,
        uint16 previousCreatorFeeBps,
        uint16 newProtocolFeeBps,
        uint16 newCreatorFeeBps,
        address indexed configuredBy
    );
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury, address indexed configuredBy);
    event TokenFeeAccountRegistered(address indexed token, address indexed curve, address indexed creator);
    event FeesAccrued(
        address indexed token,
        address indexed curve,
        address indexed creator,
        bool isBuy,
        uint256 protocolFee,
        uint256 creatorFee
    );
    event ProtocolFeesClaimed(address indexed treasury, uint256 amount);
    event CreatorFeesClaimed(address indexed token, address indexed creator, uint256 amount);

    function treasury() external view returns (address);

    function protocolFeeBps() external view returns (uint16);

    function creatorFeeBps() external view returns (uint16);

    function curveOf(address token) external view returns (address);

    function creatorOf(address token) external view returns (address);

    function protocolFeesAccrued() external view returns (uint256);

    function creatorFeesAccrued(address token) external view returns (uint256);

    function totalCreatorFeesAccrued() external view returns (uint256);

    function totalLiabilities() external view returns (uint256);

    function setFeeConfiguration(uint16 protocolFeeBps_, uint16 creatorFeeBps_) external;

    function setTreasury(address newTreasury) external;

    function registerToken(address token, address creator) external;

    function calculateBuyFees(uint256 curveValue) external view returns (uint256 protocolFee, uint256 creatorFee);

    function calculateSellFees(uint256 curveValue) external view returns (uint256 protocolFee, uint256 creatorFee);

    function accrueBuyFees(address token, uint256 curveValue)
        external
        payable
        returns (uint256 protocolFee, uint256 creatorFee);

    function accrueSellFees(address token, uint256 curveValue)
        external
        payable
        returns (uint256 protocolFee, uint256 creatorFee);

    function claimProtocolFees() external returns (uint256 amount);

    function claimCreatorFees(address token) external returns (uint256 amount);
}
