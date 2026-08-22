// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interface for Moonwell's mTokens (Compound V2-compatible
///         market contracts) on Base. Each market (mUSDC, mWETH, ...) is its own
///         contract: supply/withdraw/borrow/repay/liquidate all happen on the
///         mToken, with the Comptroller enforcing collateral & risk policy.
///         Full interface: https://github.com/moonwell-fi/contracts-open-source
interface IMoonwellMarket {
    /// @notice Liquidates an undercollateralized position. Called on the mToken of
    ///         the DEBT asset. Pulls `repayAmount` of the debt underlying from the
    ///         caller (approve this mToken first), then seizes the borrower's
    ///         collateral as mTokens and transfers those mTokens to the caller.
    ///         The collateral mToken amount is determined by the Comptroller's
    ///         liquidation incentive, collateral exchange rate and protocol seize
    ///         share. A successful call returns Compound error code 0.
    function liquidateBorrow(address borrower, uint256 repayAmount, address mTokenCollateral)
        external
        returns (uint256);

    /// @notice Redeems `redeemTokens` mTokens for their underlying token.
    ///         Standard Moonwell liquidations deliver collateral as mTokens, so a
    ///         standard liquidation route must redeem the mTokens before selling
    ///         the collateral underlying on a DEX.
    /// @return 0 on success; a non-zero error code otherwise (Compound-style).
    function redeem(uint256 redeemTokens) external returns (uint256);

    /// @notice Redeems underlying tokens by specifying the exact underlying amount.
    ///         Useful when an OEV route has already determined the desired
    ///         underlying amount. Standard liquidation routes should normally use
    ///         redeem() with the actual mToken balance delta produced by the
    ///         liquidation.
    /// @param redeemAmount The exact amount of underlying tokens to redeem.
    /// @return 0 on success; a non-zero error code otherwise (Compound-style).
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);

    /// @notice The current exchange rate: 1 mToken = `exchangeRate / 1e18`
    ///         underlying (18-decimal mantissa). Grows as interest accrues.
    function exchangeRateStored() external view returns (uint256);

    /// @notice Share of gross seized collateral kept by the Moonwell protocol
    ///         reserves. This value is read from the collateral mToken because it
    ///         is a per-market parameter.
    function protocolSeizeShareMantissa() external view returns (uint256);

    /// @notice A borrower's borrow balance in underlying, without accruing interest.
    function borrowBalanceStored(address account) external view returns (uint256);

    /// @notice The underlying ERC20 this market supplies and borrows.
    function underlying() external view returns (address);

    /// @notice The Comptroller this market is registered with.
    function comptroller() external view returns (address);
}
