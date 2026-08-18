// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interface for Moonwell's mTokens (Compound V2-compatible
///         market contracts) on Base. Each market (mUSDC, mWETH, ...) is its own
///         contract: supply/withdraw/borrow/repay/liquidate all happen on the
///         mToken, with the Comptroller enforcing collateral & risk policy.
///         Full interface: https://github.com/moonwell-fi/contracts-open-source
interface IMoonwellMarket {
    /// @notice Liquidates an undercollateralized position. Called on the mToken of
    ///         the DEBT asset. Pulls `repayAmount` (capped by the close factor and
    ///         the borrower's borrow balance) of the debt underlying from the caller
    ///         — approve this mToken first — then seizes the borrower's collateral in
    ///         the `mTokenCollateral` market and transfers it to the caller as the
    ///         UNDERLYING token, at a discount (the liquidation incentive net of the
    ///         protocol's reserve share). This discount is the spread the bot
    ///         arbitrages against DEX prices.
    /// @return 0 on success; a non-zero error code otherwise (Compound-style).
    ///         Unlike Aave, business-logic failures (e.g. "position not
    ///         liquidatable") may return an error code instead of reverting —
    ///         off-chain tooling should check the return value in simulation.
    function liquidateBorrow(address borrower, uint256 repayAmount, address mTokenCollateral)
        external
        returns (uint256);

    /// @notice Redeems `redeemTokens` mTokens for their underlying token.
    ///         Needed after an OEV liquidation, which pays the liquidator in mTokens.
    /// @return 0 on success; a non-zero error code otherwise (Compound-style).
    function redeem(uint256 redeemTokens) external returns (uint256);

    /// @notice The current exchange rate: 1 mToken = `exchangeRate / 1e18`
    ///         underlying (18-decimal mantissa). Grows as interest accrues.
    function exchangeRateStored() external view returns (uint256);

    /// @notice Share of gross seized collateral kept by the Moonwell protocol
    ///         reserves (0.03e18 on Moonwell Base → the liquidator nets 7% of the
    ///         10% liquidation incentive). Stored per-market on the mToken — the
    ///         Comptroller does NOT expose it (verified on Base, Aug 2026).
    function protocolSeizeShareMantissa() external view returns (uint256);

    /// @notice A borrower's borrow balance in underlying, without accruing interest.
    function borrowBalanceStored(address account) external view returns (uint256);

    /// @notice The underlying ERC20 this market supplies and borrows.
    function underlying() external view returns (address);

    /// @notice The Comptroller this market is registered with.
    function comptroller() external view returns (address);
}
