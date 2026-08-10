// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IZonkCurve {
    struct Curve {
        address token;
        address creator;
        uint256 curveSupply;
        uint256 soldSupply;
        uint256 reserveBalance;
        uint256 startingPrice;
        uint256 slope;
        uint256 graduationThreshold;
        bool graduated;
    }

    error AlreadyGraduated();
    error CurveAlreadyExists();
    error CurveNotFound();
    error FeeTransferFailed();
    error InsufficientCurveInventory();
    error InsufficientMsgValue();
    error InsufficientReserve();
    error InvalidAmount();
    error InvalidCurveParameters();
    error InvalidFactory();
    error InvalidProtocolRecipient();
    error InvalidRecipient();
    error OnlyTokenCreator();
    error SlippageExceeded();
    error TokenNotRegistered();
    error TokenTransferFailed();
    error UnexpectedEther();

    event CurveCreated(
        address indexed token,
        address indexed creator,
        uint256 curveSupply,
        uint256 startingPrice,
        uint256 slope,
        uint256 graduationThreshold
    );

    event TokensBought(
        address indexed token,
        address indexed buyer,
        uint256 tokenAmount,
        uint256 reserveIn,
        uint256 curveCost,
        uint256 protocolFee,
        uint256 creatorFee
    );

    event TokensSold(
        address indexed token,
        address indexed seller,
        uint256 tokenAmount,
        uint256 reserveOut,
        uint256 curveValue,
        uint256 protocolFee,
        uint256 creatorFee
    );

    event Graduated(address indexed token, uint256 soldSupply, uint256 reserveBalance);

    function createCurve(
        address token,
        uint256 curveSupply,
        uint256 startingPrice,
        uint256 slope,
        uint256 graduationThreshold
    ) external returns (Curve memory curveState);

    function curve(address token) external view returns (Curve memory curveState);

    function quoteBuy(address token, uint256 tokenAmount)
        external
        view
        returns (uint256 reserveIn, uint256 curveCost, uint256 protocolFee, uint256 creatorFee);

    function quoteSell(address token, uint256 tokenAmount)
        external
        view
        returns (uint256 reserveOut, uint256 curveValue, uint256 protocolFee, uint256 creatorFee);

    function buy(address token, uint256 tokenAmount, uint256 maxReserveIn) external payable returns (uint256 reserveIn);

    function sell(address token, uint256 tokenAmount, uint256 minReserveOut) external returns (uint256 reserveOut);
}
