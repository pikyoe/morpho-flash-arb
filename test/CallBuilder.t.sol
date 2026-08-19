// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CallBuilder} from "../src/libraries/CallBuilder.sol";
import {FlashLoanArbitrage} from "../src/FlashLoanArbitrage.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAerodromeRouter} from "../src/interfaces/IAerodromeRouter.sol";
import {IMoonwellMarket} from "../src/interfaces/IMoonwellMarket.sol";
import {IMoonwellOevWrapper} from "../src/interfaces/IMoonwellOevWrapper.sol";
import {BaseAddresses} from "../src/BaseAddresses.sol";

/// @notice Pure unit tests for the CallBuilder library.
///         Verifies that each helper produces the correct ABI-encoded calldata
///         for its target contract, without needing any network connection.
/// @dev    Run: forge test --match-contract CallBuilderTest -vvv
contract CallBuilderTest is Test {
    address token = address(0x1111);
    address spender = address(0x2222);
    address router = address(0x3333);
    address poolFactory = address(0x4444);
    address recipient = address(0x5555);

    function test_approve_encodesCorrectly() public view {
        FlashLoanArbitrage.Call memory call = CallBuilder.approve(token, spender, 1 ether);
        assertEq(call.target, token);
        assertEq(call.value, 0);
        assertEq(call.data, abi.encodeCall(IERC20.approve, (spender, 1 ether)));
    }

    function test_aerodromeSwap_encodesCorrectly() public view {
        uint256 amountIn = 1000e18;
        uint256 amountOutMin = 900e18;
        address tokenIn = address(0xAAAA);
        address tokenOut = address(0xBBBB);
        bool stable = true;
        uint256 deadline = block.timestamp + 300;

        FlashLoanArbitrage.Call memory call = CallBuilder.aerodromeSwap(
            router, amountIn, amountOutMin, tokenIn, tokenOut, stable, poolFactory, recipient, deadline
        );

        assertEq(call.target, router);
        assertEq(call.value, 0);

        IAerodromeRouter.Route[] memory routes = new IAerodromeRouter.Route[](1);
        routes[0] = IAerodromeRouter.Route({from: tokenIn, to: tokenOut, stable: stable, factory: poolFactory});
        assertEq(
            call.data,
            abi.encodeCall(
                IAerodromeRouter.swapExactTokensForTokens,
                (amountIn, amountOutMin, routes, recipient, deadline)
            )
        );
    }

    function test_moonwellLiquidateBorrow_encodesCorrectly() public pure {
        address mTokenDebt = BaseAddresses.MOONWELL_M_USDC;
        address borrower = address(0x6666);
        uint256 repayAmount = 10_000e6;
        address mTokenCollateral = BaseAddresses.MOONWELL_M_WETH;

        FlashLoanArbitrage.Call memory call =
            CallBuilder.moonwellLiquidateBorrow(mTokenDebt, borrower, repayAmount, mTokenCollateral);

        assertEq(call.target, mTokenDebt);
        assertEq(call.value, 0);
        assertEq(
            call.data,
            abi.encodeCall(IMoonwellMarket.liquidateBorrow, (borrower, repayAmount, mTokenCollateral))
        );
    }

    function test_moonwellLiquidationLeg_returns2Calls() public pure {
        address debtUnderlying = BaseAddresses.USDC;
        address mTokenDebt = BaseAddresses.MOONWELL_M_USDC;
        address borrower = address(0x7777);
        uint256 repayAmount = 5_000e6;
        address mTokenCollateral = BaseAddresses.MOONWELL_M_WETH;

        FlashLoanArbitrage.Call[] memory calls =
            CallBuilder.moonwellLiquidationLeg(debtUnderlying, mTokenDebt, borrower, repayAmount, mTokenCollateral);

        assertEq(calls.length, 2);
        assertEq(calls[0].target, debtUnderlying);
        assertEq(calls[0].value, 0);
        assertEq(calls[0].data, abi.encodeCall(IERC20.approve, (mTokenDebt, repayAmount)));
        assertEq(calls[1].target, mTokenDebt);
        assertEq(calls[1].value, 0);
        assertEq(
            calls[1].data,
            abi.encodeCall(IMoonwellMarket.liquidateBorrow, (borrower, repayAmount, mTokenCollateral))
        );
    }

    function test_moonwellOevLiquidationLeg_returns2Calls() public pure {
        address debtUnderlying = BaseAddresses.USDC;
        address oevWrapper = BaseAddresses.MOONWELL_OEV_WRAPPER_WETH;
        address borrower = address(0x8888);
        uint256 repayAmount = 5_000e6;
        address mTokenCollateral = BaseAddresses.MOONWELL_M_WETH;
        address mTokenLoan = BaseAddresses.MOONWELL_M_USDC;

        FlashLoanArbitrage.Call[] memory calls = CallBuilder.moonwellOevLiquidationLeg(
            debtUnderlying, oevWrapper, borrower, repayAmount, mTokenCollateral, mTokenLoan
        );

        assertEq(calls.length, 2);
        assertEq(calls[0].target, debtUnderlying);
        assertEq(calls[0].value, 0);
        assertEq(calls[0].data, abi.encodeCall(IERC20.approve, (oevWrapper, repayAmount)));
        assertEq(calls[1].target, oevWrapper);
        assertEq(calls[1].value, 0);
        assertEq(
            calls[1].data,
            abi.encodeCall(
                IMoonwellOevWrapper.updatePriceEarlyAndLiquidate,
                (borrower, repayAmount, mTokenCollateral, mTokenLoan)
            )
        );
    }

    function test_moonwellRedeem_encodesCorrectly() public pure {
        address mToken = BaseAddresses.MOONWELL_M_WETH;
        uint256 redeemTokens = 1e18;

        FlashLoanArbitrage.Call memory call = CallBuilder.moonwellRedeem(mToken, redeemTokens);
        assertEq(call.target, mToken);
        assertEq(call.value, 0);
        assertEq(call.data, abi.encodeCall(IMoonwellMarket.redeem, (redeemTokens)));
    }

    // --- NEW: moonwellRedeemUnderlying ---

    function test_moonwellRedeemUnderlying_encodesCorrectly() public pure {
        address mToken = BaseAddresses.MOONWELL_M_WETH;
        uint256 redeemAmount = 1_500e18; // 1.5 WETH

        FlashLoanArbitrage.Call memory call = CallBuilder.moonwellRedeemUnderlying(mToken, redeemAmount);
        assertEq(call.target, mToken);
        assertEq(call.value, 0);
        assertEq(call.data, abi.encodeCall(IMoonwellMarket.redeemUnderlying, (redeemAmount)));
    }

    // --- NEW: estimateMTokenFromUnderlying ---

    function test_estimateMTokenFromUnderlying_basicCase() public pure {
        // 1 mWETH = 1.02 WETH (exchange rate = 1.02e18)
        uint256 underlyingAmount = 1_020e18;
        uint256 exchangeRate = 1.02e18;

        uint256 mTokens = CallBuilder.estimateMTokenFromUnderlying(underlyingAmount, exchangeRate);
        // 1020 * 1e18 / 1.02e18 = 1000 mTokens
        assertEq(mTokens, 1000e18);
    }

    function test_estimateMTokenFromUnderlying_oneToOne() public pure {
        uint256 mTokens = CallBuilder.estimateMTokenFromUnderlying(5e18, 1e18);
        assertEq(mTokens, 5e18);
    }

    function test_estimateMTokenFromUnderlying_highRate() public pure {
        // 1 mToken = 2 underlying
        uint256 mTokens = CallBuilder.estimateMTokenFromUnderlying(1e18, 2e18);
        assertEq(mTokens, 0.5e18);
    }

    // --- NEW: moonwellOevRedeemAndApprove ---

    function test_moonwellOevRedeemAndApprove_returns2Calls() public pure {
        address mTokenCollateral = BaseAddresses.MOONWELL_M_WETH;
        address collateralUnderlying = BaseAddresses.WETH;
        uint256 redeemAmount = 1_500e18;
        address dexRouter = BaseAddresses.AERODROME_ROUTER;

        FlashLoanArbitrage.Call[] memory calls = CallBuilder.moonwellOevRedeemAndApprove(
            mTokenCollateral, collateralUnderlying, redeemAmount, dexRouter
        );

        assertEq(calls.length, 2);

        // First: redeemUnderlying on mToken
        assertEq(calls[0].target, mTokenCollateral);
        assertEq(calls[0].data, abi.encodeCall(IMoonwellMarket.redeemUnderlying, (redeemAmount)));

        // Second: approve underlying to router
        assertEq(calls[1].target, collateralUnderlying);
        assertEq(calls[1].data, abi.encodeCall(IERC20.approve, (dexRouter, redeemAmount)));
    }

    // --- NEW: Full OEV route composition test ---

    function test_fullOevRoute_composesCorrectly() public pure {
        address debtUnderlying = BaseAddresses.USDC;
        address collateralUnderlying = BaseAddresses.WETH;
        address oevWrapper = BaseAddresses.MOONWELL_OEV_WRAPPER_WETH;
        address mTokenDebt = BaseAddresses.MOONWELL_M_USDC;
        address mTokenCollateral = BaseAddresses.MOONWELL_M_WETH;
        address borrower = address(0x9999);
        uint256 repayAmount = 5_000e6;
        uint256 estimatedSeized = 1_500e18;
        address dexRouter = BaseAddresses.AERODROME_ROUTER;

        // Step 1: OEV liquidation leg (2 calls)
        FlashLoanArbitrage.Call[] memory oevLeg = CallBuilder.moonwellOevLiquidationLeg(
            debtUnderlying, oevWrapper, borrower, repayAmount, mTokenCollateral, mTokenDebt
        );

        // Step 2: Redeem + approve for DEX (2 calls)
        FlashLoanArbitrage.Call[] memory redeemLeg = CallBuilder.moonwellOevRedeemAndApprove(
            mTokenCollateral, collateralUnderlying, estimatedSeized, dexRouter
        );

        // Total: approve_debt + liquidate + redeem + approve_to_router = 4 calls
        assertEq(oevLeg.length + redeemLeg.length, 4);

        // Verify call flow order
        assertEq(oevLeg[0].target, debtUnderlying);       // approve USDC to wrapper
        assertEq(oevLeg[1].target, oevWrapper);            // wrapper.liquidate
        assertEq(redeemLeg[0].target, mTokenCollateral);   // mWETH.redeemUnderlying
        assertEq(redeemLeg[1].target, collateralUnderlying); // WETH.approve to router
    }

    // --- estimateMoonwellSeizedUnderlying ---

    function test_estimateMoonwellSeizedUnderlying_basicCase() public pure {
        uint256 repayAmount = 10_000e6;
        uint256 priceBorrowed = 1e18;
        uint256 priceCollateral = 3000e18;
        uint256 exchangeRateCollateral = 1.02e18;
        uint256 liquidationIncentive = 1.10e18;
        uint256 protocolSeizeShare = 0.03e18;

        uint256 seized = CallBuilder.estimateMoonwellSeizedUnderlying(
            repayAmount, priceBorrowed, priceCollateral, exchangeRateCollateral,
            liquidationIncentive, protocolSeizeShare
        );

        assertTrue(seized > 0, "Should seize some collateral");
        assertTrue(seized > 3e6 && seized < 4e6, "Seized amount in expected range");
    }

    function test_estimateMoonwellSeizedUnderlying_zeroProtocolShare() public pure {
        uint256 repayAmount = 10_000e6;
        uint256 priceBorrowed = 1e18;
        uint256 priceCollateral = 2000e18;
        uint256 exchangeRate = 1e18;
        uint256 incentive = 1.10e18;
        uint256 protocolShare = 0;

        uint256 seized = CallBuilder.estimateMoonwellSeizedUnderlying(
            repayAmount, priceBorrowed, priceCollateral, exchangeRate, incentive, protocolShare
        );

        assertTrue(seized > 5e6 && seized < 6e6, "Full incentive without protocol share");
    }
}
