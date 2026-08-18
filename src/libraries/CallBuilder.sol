// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAerodromeRouter} from "../interfaces/IAerodromeRouter.sol";
import {IAaveV3Pool} from "../interfaces/IAaveV3Pool.sol";
import {IMoonwellMarket} from "../interfaces/IMoonwellMarket.sol";
import {IMoonwellOevWrapper} from "../interfaces/IMoonwellOevWrapper.sol";
import {FlashLoanArbitrage} from "../FlashLoanArbitrage.sol";

/// @notice Pure helper functions for building `FlashLoanArbitrage.Call[]` routes.
///         Used by tests and by off-chain tooling (via `cast` or an ABI-compatible
///         encoder) to assemble arbitrage calldata without hand-rolling `abi.encode`
///         everywhere. Not deployed on its own — it's a library for building tx data.
library CallBuilder {
    /// @notice Builds an `approve` call so the arbitrage contract can grant a router
    ///         or pool an allowance before swapping/supplying.
    function approve(address token, address spender, uint256 amount)
        internal
        pure
        returns (FlashLoanArbitrage.Call memory)
    {
        return FlashLoanArbitrage.Call({
            target: token,
            value: 0,
            data: abi.encodeCall(IERC20.approve, (spender, amount))
        });
    }

    /// @notice Builds an Aerodrome `swapExactTokensForTokens` call for a single-hop route.
    function aerodromeSwap(
        address router,
        uint256 amountIn,
        uint256 amountOutMin,
        address tokenIn,
        address tokenOut,
        bool stable,
        address poolFactory,
        address recipient,
        uint256 deadline
    ) internal pure returns (FlashLoanArbitrage.Call memory) {
        IAerodromeRouter.Route[] memory routes = new IAerodromeRouter.Route[](1);
        routes[0] = IAerodromeRouter.Route({from: tokenIn, to: tokenOut, stable: stable, factory: poolFactory});

        return FlashLoanArbitrage.Call({
            target: router,
            value: 0,
            data: abi.encodeCall(
                IAerodromeRouter.swapExactTokensForTokens, (amountIn, amountOutMin, routes, recipient, deadline)
            )
        });
    }

    /// @notice Builds an Aave V3 `supply` call (the "lending protocol" leg).
    function aaveSupply(address pool, address asset, uint256 amount, address onBehalfOf)
        internal
        pure
        returns (FlashLoanArbitrage.Call memory)
    {
        return FlashLoanArbitrage.Call({
            target: pool,
            value: 0,
            data: abi.encodeCall(IAaveV3Pool.supply, (asset, amount, onBehalfOf, 0))
        });
    }

    /// @notice Builds an Aave V3 `withdraw` call (the "lending protocol" leg).
    function aaveWithdraw(address pool, address asset, uint256 amount, address to)
        internal
        pure
        returns (FlashLoanArbitrage.Call memory)
    {
        return FlashLoanArbitrage.Call({
            target: pool,
            value: 0,
            data: abi.encodeCall(IAaveV3Pool.withdraw, (asset, amount, to))
        });
    }

    /// @notice Builds an Aave V3 `liquidationCall` — the core "lending protocol" leg
    ///         of a liquidation-arbitrage route: repay part of an undercollateralized
    ///         user's debt, receive their collateral at a discount, then sell that
    ///         collateral on a DEX (see `aerodromeSwap`) to realize the spread.
    function aaveLiquidationCall(
        address pool,
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) internal pure returns (FlashLoanArbitrage.Call memory) {
        return FlashLoanArbitrage.Call({
            target: pool,
            value: 0,
            data: abi.encodeCall(
                IAaveV3Pool.liquidationCall, (collateralAsset, debtAsset, user, debtToCover, receiveAToken)
            )
        });
    }

    // ---------------------------------------------------------------------------
    // Moonwell (Compound V2 fork on Base)
    // ---------------------------------------------------------------------------

    /// @notice Builds the Moonwell liquidation call on the DEBT mToken: repays
    ///         `repayAmount` of `borrower`'s debt and seizes collateral from the
    ///         `mTokenCollateral` market. Seized collateral is transferred to the
    ///         caller as the UNDERLYING token (approve the debt mToken first — see
    ///         `moonwellLiquidationLeg`).
    function moonwellLiquidateBorrow(
        address mTokenDebt,
        address borrower,
        uint256 repayAmount,
        address mTokenCollateral
    ) internal pure returns (FlashLoanArbitrage.Call memory) {
        return FlashLoanArbitrage.Call({
            target: mTokenDebt,
            value: 0,
            data: abi.encodeCall(IMoonwellMarket.liquidateBorrow, (borrower, repayAmount, mTokenCollateral))
        });
    }

    /// @notice Builds the approve + liquidate pair for a standard (non-OEV) Moonwell
    ///         liquidation leg: first grant the debt mToken an allowance to pull
    ///         `repayAmount` of the debt underlying, then liquidate. Chain this with
    ///         an `approve(collateralUnderlying, router, seized)` + `aerodromeSwap`
    ///         to complete the arbitrage route.
    function moonwellLiquidationLeg(
        address debtUnderlying,
        address mTokenDebt,
        address borrower,
        uint256 repayAmount,
        address mTokenCollateral
    ) internal pure returns (FlashLoanArbitrage.Call[] memory calls) {
        calls = new FlashLoanArbitrage.Call[](2);
        calls[0] = approve(debtUnderlying, mTokenDebt, repayAmount);
        calls[1] = moonwellLiquidateBorrow(mTokenDebt, borrower, repayAmount, mTokenCollateral);
    }

    /// @notice Builds the approve + OEV liquidation pair for Moonwell's
    ///         ChainlinkOEVWrapper — the competitive path that unlocks a fresh
    ///         Chainlink price inside its ~10s window. `oevWrapper` is
    ///         per-collateral: it must match `mTokenCollateral`'s Chainlink feed.
    ///         The liquidator's share arrives as mTokens, so the route must redeem
    ///         them (see `moonwellRedeem`) before swapping on a DEX.
    function moonwellOevLiquidationLeg(
        address debtUnderlying,
        address oevWrapper,
        address borrower,
        uint256 repayAmount,
        address mTokenCollateral,
        address mTokenLoan
    ) internal pure returns (FlashLoanArbitrage.Call[] memory calls) {
        calls = new FlashLoanArbitrage.Call[](2);
        calls[0] = approve(debtUnderlying, oevWrapper, repayAmount);
        calls[1] = FlashLoanArbitrage.Call({
            target: oevWrapper,
            value: 0,
            data: abi.encodeCall(
                IMoonwellOevWrapper.updatePriceEarlyAndLiquidate,
                (borrower, repayAmount, mTokenCollateral, mTokenLoan)
            )
        });
    }

    /// @notice Builds a `redeem` call converting mTokens back to their underlying
    ///         token — required after an OEV liquidation, which pays out in mTokens.
    function moonwellRedeem(address mToken, uint256 redeemTokens)
        internal
        pure
        returns (FlashLoanArbitrage.Call memory)
    {
        return FlashLoanArbitrage.Call({
            target: mToken,
            value: 0,
            data: abi.encodeCall(IMoonwellMarket.redeem, (redeemTokens))
        });
    }

    /// @notice Estimates the underlying collateral a liquidator actually receives for
    ///         repaying `repayAmount` of debt, mirroring the on-chain math:
    ///         `Comptroller.liquidateCalculateSeizeTokens()` (gross, full incentive)
    ///         minus the protocol's reserve share of the seized mTokens.
    /// @param priceBorrowed / priceCollateral USD prices from the Moonwell oracle
    ///        (both in the same 18-decimal mantissa).
    /// @param exchangeRateCollateral `mTokenCollateral.exchangeRateStored()` (18-dec).
    /// @param liquidationIncentiveMantissa e.g. 1.10e18 on Moonwell Base.
    /// @param protocolSeizeShareMantissa e.g. 0.03e18 on Moonwell Base.
    /// @return liquidatorUnderlying Net collateral, denominated in the collateral
    ///         underlying token (what the DEX leg must sell).
    function estimateMoonwellSeizedUnderlying(
        uint256 repayAmount,
        uint256 priceBorrowed,
        uint256 priceCollateral,
        uint256 exchangeRateCollateral,
        uint256 liquidationIncentiveMantissa,
        uint256 protocolSeizeShareMantissa
    ) internal pure returns (uint256 liquidatorUnderlying) {
        // Gross seized mTokens = repayAmount * priceBorrowed * incentive
        //                       / (priceCollateral * exchangeRateCollateral)
        uint256 grossSeizeTokens = (repayAmount * priceBorrowed * liquidationIncentiveMantissa)
            / (priceCollateral * exchangeRateCollateral);

        // Protocol keeps `protocolSeizeShare` of the gross seized mTokens.
        uint256 liquidatorSeizeTokens = grossSeizeTokens * (1e18 - protocolSeizeShareMantissa) / 1e18;

        // Underlying seized = mTokens * exchangeRate.
        liquidatorUnderlying = liquidatorSeizeTokens * exchangeRateCollateral / 1e18;
    }
}
