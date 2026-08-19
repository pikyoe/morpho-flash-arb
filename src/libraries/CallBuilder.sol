// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAerodromeRouter} from "../interfaces/IAerodromeRouter.sol";
import {IMoonwellMarket} from "../interfaces/IMoonwellMarket.sol";
import {IMoonwellOevWrapper} from "../interfaces/IMoonwellOevWrapper.sol";
import {FlashLoanArbitrage} from "../FlashLoanArbitrage.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

library CallBuilder {
    function approve(address token, address spender, uint256 amount) internal pure returns (FlashLoanArbitrage.Call memory) {
        return FlashLoanArbitrage.Call({target: token, value: 0, data: abi.encodeCall(IERC20.approve, (spender, amount))});
    }

    function aerodromeSwap(
        address router, uint256 amountIn, uint256 amountOutMin, address tokenIn, address tokenOut,
        bool stable, address poolFactory, address recipient, uint256 deadline
    ) internal pure returns (FlashLoanArbitrage.Call memory) {
        IAerodromeRouter.Route[] memory routes = new IAerodromeRouter.Route[](1);
        routes[0] = IAerodromeRouter.Route({from: tokenIn, to: tokenOut, stable: stable, factory: poolFactory});
        return FlashLoanArbitrage.Call({
            target: router, value: 0,
            data: abi.encodeCall(IAerodromeRouter.swapExactTokensForTokens, (amountIn, amountOutMin, routes, recipient, deadline))
        });
    }

    function moonwellLiquidateBorrow(address mTokenDebt, address borrower, uint256 repayAmount, address mTokenCollateral)
        internal pure returns (FlashLoanArbitrage.Call memory)
    {
        return FlashLoanArbitrage.Call({target: mTokenDebt, value: 0, data: abi.encodeCall(IMoonwellMarket.liquidateBorrow, (borrower, repayAmount, mTokenCollateral))});
    }

    function moonwellLiquidationLeg(address debtUnderlying, address mTokenDebt, address borrower, uint256 repayAmount, address mTokenCollateral)
        internal pure returns (FlashLoanArbitrage.Call[] memory calls)
    {
        calls = new FlashLoanArbitrage.Call[](2);
        calls[0] = approve(debtUnderlying, mTokenDebt, repayAmount);
        calls[1] = moonwellLiquidateBorrow(mTokenDebt, borrower, repayAmount, mTokenCollateral);
    }

    function moonwellOevLiquidationLeg(address debtUnderlying, address oevWrapper, address borrower, uint256 repayAmount, address mTokenCollateral, address mTokenLoan)
        internal pure returns (FlashLoanArbitrage.Call[] memory calls)
    {
        calls = new FlashLoanArbitrage.Call[](2);
        calls[0] = approve(debtUnderlying, oevWrapper, repayAmount);
        calls[1] = FlashLoanArbitrage.Call({
            target: oevWrapper, value: 0,
            data: abi.encodeCall(IMoonwellOevWrapper.updatePriceEarlyAndLiquidate, (borrower, repayAmount, mTokenCollateral, mTokenLoan))
        });
    }

    /// @notice Redeems `redeemTokens` mTokens for underlying. Use this when you
    ///         know the exact mToken amount. For most OEV routes, prefer
    ///         `moonwellRedeemUnderlying` which takes the underlying amount directly.
    function moonwellRedeem(address mToken, uint256 redeemTokens) internal pure returns (FlashLoanArbitrage.Call memory) {
        return FlashLoanArbitrage.Call({target: mToken, value: 0, data: abi.encodeCall(IMoonwellMarket.redeem, (redeemTokens))});
    }

    /// @notice Redeems underlying tokens by specifying the exact underlying amount.
    ///         Preferred after OEV liquidation: the bot knows the underlying amount
    ///         from `estimateMoonwellSeizedUnderlying`, no manual exchange rate math needed.
    function moonwellRedeemUnderlying(address mToken, uint256 redeemAmount) internal pure returns (FlashLoanArbitrage.Call memory) {
        return FlashLoanArbitrage.Call({target: mToken, value: 0, data: abi.encodeCall(IMoonwellMarket.redeemUnderlying, (redeemAmount))});
    }

    /// @notice Converts underlying amount to mToken amount via exchange rate.
    ///         Use when you have underlying (from `estimateMoonwellSeizedUnderlying`)
    ///         but need to call `redeem(uint256)` instead of `redeemUnderlying(uint256)`.
    function estimateMTokenFromUnderlying(uint256 underlyingAmount, uint256 exchangeRate)
        internal pure returns (uint256 mTokenAmount)
    {
        mTokenAmount = Math.mulDiv(underlyingAmount, 1e18, exchangeRate);
    }

    /// @notice Builds OEV redeem + approve route: redeems underlying from mTokens,
    ///         then approves the DEX router. Standard follow-up to `moonwellOevLiquidationLeg`.
    function moonwellOevRedeemAndApprove(
        address mTokenCollateral, address collateralUnderlying, uint256 redeemAmount, address router
    ) internal pure returns (FlashLoanArbitrage.Call[] memory calls) {
        calls = new FlashLoanArbitrage.Call[](2);
        calls[0] = moonwellRedeemUnderlying(mTokenCollateral, redeemAmount);
        calls[1] = approve(collateralUnderlying, router, redeemAmount);
    }

    /// @notice Estimates underlying collateral received from liquidation.
    ///         Mirrors `Comptroller.liquidateCalculateSeizeTokens()` on-chain math.
    function estimateMoonwellSeizedUnderlying(
        uint256 repayAmount, uint256 priceBorrowed, uint256 priceCollateral,
        uint256 exchangeRateCollateral, uint256 liquidationIncentiveMantissa, uint256 protocolSeizeShareMantissa
    ) internal pure returns (uint256 liquidatorUnderlying) {
        require(priceCollateral != 0 && exchangeRateCollateral != 0, "zero price/rate");
        require(protocolSeizeShareMantissa <= 1e18, "invalid seize share");

        uint256 debtValue = Math.mulDiv(repayAmount, priceBorrowed, priceCollateral);
        uint256 valueWithIncentive = Math.mulDiv(debtValue, liquidationIncentiveMantissa, 1e18);
        uint256 grossSeizeTokens = Math.mulDiv(valueWithIncentive, 1e18, exchangeRateCollateral);
        uint256 liquidatorSeizeTokens = Math.mulDiv(grossSeizeTokens, 1e18 - protocolSeizeShareMantissa, 1e18);
        liquidatorUnderlying = Math.mulDiv(liquidatorSeizeTokens, exchangeRateCollateral, 1e18);
    }
}
