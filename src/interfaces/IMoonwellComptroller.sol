// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interface for Moonwell's Comptroller on Base — the policy layer
///         that tracks account health and exposes the liquidation parameters the
///         off-chain bot needs (close factor, liquidation incentive, oracle).
///         Full interface: https://github.com/moonwell-fi/contracts-open-source
interface IMoonwellComptroller {
    /// @notice Returns an account's aggregate health in USD (18-decimal mantissa).
    ///         `error == 0 && shortfall > 0` means the account is liquidatable.
    function getAccountLiquidity(address account)
        external
        view
        returns (uint256 error, uint256 liquidity, uint256 shortfall);

    /// @notice Max share of the borrower's borrow balance a single liquidation can
    ///         repay (e.g. 0.5e18 = 50% on Moonwell Base).
    function closeFactorMantissa() external view returns (uint256);

    /// @notice Liquidation incentive mantissa (1.10e18 on Moonwell Base = a 10%
    ///         bonus on the collateral seized; the protocol keeps ~3% of that,
    ///         see `protocolSeizeShareMantissa`).
    function liquidationIncentiveMantissa() external view returns (uint256);

    /// @notice Share of gross seized collateral kept by the protocol reserves
    ///         (0.03e18 on Moonwell Base → liquidator keeps 7% of the 10% bonus).
    ///         @dev May revert on older Moonwell deployments — off-chain tooling
    ///              should fall back to a hardcoded 0.03e18 if this call fails.
    function protocolSeizeShareMantissa() external view returns (uint256);

    /// @notice Whether `mToken` is listed as a market and its collateral factor.
    function markets(address mToken)
        external
        view
        returns (bool isListed, uint256 collateralFactorMantissa);

    /// @notice The oracle contract used for pricing (Moonwell ChainlinkOracle).
    function oracle() external view returns (address);

    /// @notice Mirrors the on-chain seize math: how many `mTokenCollateral` mTokens
    ///         are seized for repaying `actualRepayAmount` of debt (including the
    ///         full liquidation incentive, before the protocol share is subtracted).
    ///         Multiply by `exchangeRateStored()` to get gross underlying seized.
    function liquidateCalculateSeizeTokens(
        address mTokenBorrowed,
        address mTokenCollateral,
        uint256 actualRepayAmount
    ) external view returns (uint256 error, uint256 seizeTokens);
}
