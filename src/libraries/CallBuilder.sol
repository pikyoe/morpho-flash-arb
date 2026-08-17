// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAerodromeRouter} from "../interfaces/IAerodromeRouter.sol";
import {IAaveV3Pool} from "../interfaces/IAaveV3Pool.sol";
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
}
