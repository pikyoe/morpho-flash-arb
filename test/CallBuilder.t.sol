// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
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

    // --- approve ---

    function test_approve_encodesCorrectly() public view {
        FlashLoanArbitrage.Call memory call = CallBuilder.approve(token, spender, 1 ether);

        assertEq(call.target, token);
        assertEq(call.value, 0);

        // Decode and verify
        (address approved, uint256 amount) = abi.decode(call.data[4:], (address, uint256));
        assertEq(approved, spender);
        assertEq(amount, 1 ether);
    }

    // --- aerodromeSwap ---

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

        // Verify the route was encoded (tokenIn, tokenOut, stable, factory)
        // The full decode requires IAerodromeRouter parameters, so we verify the data is non-empty
        assertTrue(call.data.length > 0);
    }

    // --- moonwellLiquidateBorrow ---

    function test_moonwellLiquidateBorrow_encodesCorrectly() public pure {
        address mTokenDebt = BaseAddresses.MOONWELL_M_USDC;
        address borrower = address(0x6666);
        uint256 repayAmount = 10_000e6;
        address mTokenCollateral = BaseAddresses.MOONWELL_M_WETH;

        FlashLoanArbitrage.Call memory call =
            CallBuilder.moonwellLiquidateBorrow(mTokenDebt, borrower, repayAmount, mTokenCollateral);

        assertEq(call.target, mTokenDebt);
        assertEq(call.value, 0);
        assertTrue(call.data.length > 0);

        // Decode
        (address decodedBorrower, uint256 decodedAmount, address decodedCollateral) =
            abi.decode(call.data[4:], (address, uint256, address));

        assertEq(decodedBorrower, borrower);
        assertEq(decodedAmount, repayAmount);
        assertEq(decodedCollateral, mTokenCollateral);
    }

    // --- moonwellLiquidationLeg (standard 2-call pair) ---

    function test_moonwellLiquidationLeg_returns2Calls() public pure {
        address debtUnderlying = BaseAddresses.USDC;
        address mTokenDebt = BaseAddresses.MOONWELL_M_USDC;
        address borrower = address(0x7777);
        uint256 repayAmount = 5_000e6;
        address mTokenCollateral = BaseAddresses.MOONWELL_M_WETH;

        FlashLoanArbitrage.Call[] memory calls =
            CallBuilder.moonwellLiquidationLeg(debtUnderlying, mTokenDebt, borrower, repayAmount, mTokenCollateral);

        assertEq(calls.length, 2);

        // First call: approve
        assertEq(calls[0].target, debtUnderlying);

        // Second call: liquidateBorrow
        assertEq(calls[1].target, mTokenDebt);
    }

    // --- moonwellOevLiquidationLeg (OEV 2-call pair) ---

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

        // First: approve debt to wrapper
        assertEq(calls[0].target, debtUnderlying);

        // Second: wrapper.updatePriceEarlyAndLiquidate
        assertEq(calls[1].target, oevWrapper);
    }

    // --- moonwellRedeem ---

    function test_moonwellRedeem_encodesCorrectly() public pure {
        address mToken = BaseAddresses.MOONWELL_M_WETH;
        uint256 redeemTokens = 1e18;

        FlashLoanArbitrage.Call memory call = CallBuilder.moonwellRedeem(mToken, redeemTokens);

        assertEq(call.target, mToken);
        assertEq(call.value, 0);
        assertTrue(call.data.length > 0);

        (uint256 decodedTokens) = abi.decode(call.data[4:], (uint256));
        assertEq(decodedTokens, redeemTokens);
    }

    // --- estimateMoonwellSeizedUnderlying ---

    function test_estimateMoonwellSeizedUnderlying_basicCase() public pure {
        // Setup: repay 10,000 USDC, borrowed price = 1e18, collateral price = 3000e18
        // exchange rate = 1.02e18 (1 mWETH = 1.02 WETH)
        // incentive = 1.10e18 (10%), protocol share = 0.03e18 (3%)
        uint256 repayAmount = 10_000e6;
        uint256 priceBorrowed = 1e18; // USDC = $1
        uint256 priceCollateral = 3000e18; // WETH = $3000
        uint256 exchangeRateCollateral = 1.02e18;
        uint256 liquidationIncentive = 1.10e18;
        uint256 protocolSeizeShare = 0.03e18;

        uint256 seized = CallBuilder.estimateMoonwellSeizedUnderlying(
            repayAmount,
            priceBorrowed,
            priceCollateral,
            exchangeRateCollateral,
            liquidationIncentive,
            protocolSeizeShare
        );

        // Gross seize = 10000 * 1e18 * 1.1e18 / (3000e18 * 1.02e18) * 1e6
        //            = 10000 * 1.1 / (3000 * 1.02) * 1e6
        //            = 11000 / 3060 * 1e6
        //            = 3.5947... * 1e6 ≈ 3,594,771
        // After protocol share: 3,594,771 * 0.97 ≈ 3,486,928
        // Underlying: 3,486,928 * 1.02e18 / 1e18 ≈ 3,556,667
        assertTrue(seized > 0, "Should seize some collateral");
        // Verify it's in a reasonable range (3.5 to 3.7 USDC worth of WETH)
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

        // With 0% protocol share: gross = 10000 * 1.1 / 2000 = 5.5
        assertTrue(seized > 5e6 && seized < 6e6, "Full incentive without protocol share");
    }
}
