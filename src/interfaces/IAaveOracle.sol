// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interface for Aave V3's price oracle. Prices are denominated
///         in the market's base currency (USD for Aave V3 Base) with a fixed
///         number of decimals (8, matching Chainlink feeds).
interface IAaveOracle {
    /// @notice Returns the price of `asset` in the oracle's base currency units.
    function getAssetPrice(address asset) external view returns (uint256);

    /// @notice The unit of the base currency (e.g. 1e8 for USD-based Aave V3 markets).
    function BASE_CURRENCY_UNIT() external view returns (uint256);
}