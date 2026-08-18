// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interface for Moonwell's ChainlinkOEVWrapper (Base core markets).
///         OEV (Oracle Extractable Value) liquidators call
///         `updatePriceEarlyAndLiquidate` inside the ~10s window before a fresh
///         Chainlink price becomes public: the wrapper unlocks the fresh price,
///         executes the liquidation and splits the seized mToken collateral between
///         the liquidator (`liquidatorFeeBps`, currently 40%) and the protocol.
/// @dev One wrapper per COLLATERAL feed — use the wrapper matching
///      `mTokenCollateral`'s underlying token (e.g. the WETH wrapper for
///      WETH-collateral positions). The wrapper derives the underlying via
///      `mTokenCollateral.underlying()` and reverts if its Chainlink feed isn't
///      registered as that token's oracle. The liquidator's share arrives as
///      mTokens (not underlying), so a route must `redeem()` them before a DEX swap.
interface IMoonwellOevWrapper {
    /// @notice Pulls `repayAmount` of the loan's underlying from the caller
    ///         (approve this wrapper first), updates the collateral's Chainlink feed
    ///         early, liquidates `borrower`'s position in the `mTokenLoan` market,
    ///         and transfers the liquidator's share of `mTokenCollateral` mTokens
    ///         back to the caller.
    function updatePriceEarlyAndLiquidate(
        address borrower,
        uint256 repayAmount,
        address mTokenCollateral,
        address mTokenLoan
    ) external;
}
