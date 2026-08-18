// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {CallBuilder} from "../src/libraries/CallBuilder.sol";
import {FlashLoanArbitrage} from "../src/FlashLoanArbitrage.sol";
import {IAerodromeRouter} from "../src/interfaces/IAerodromeRouter.sol";
import {IMoonwellMarket} from "../src/interfaces/IMoonwellMarket.sol";
import {IMoonwellOevWrapper} from "../src/interfaces/IMoonwellOevWrapper.sol";

/// @notice Pure unit tests (no fork needed) that verify CallBuilder produces the
///         exact calldata a real call would expect.
contract CallBuilderTest is Test {
    address internal constant TOKEN = address(0x1111);
    address internal constant SPENDER = address(0x2222);
    address internal constant ROUTER = address(0x3333);
    address internal constant POOL = address(0x4444);
    address internal constant FACTORY = address(0x5555);
    address internal constant USER = address(0x6666);

    function test_Approve() public pure {
        FlashLoanArbitrage.Call memory call = CallBuilder.approve(TOKEN, SPENDER, 100);
        assertEq(call.target, TOKEN);
        assertEq(call.value, 0);
        assertEq(call.data, abi.encodeCall(IERC20.approve, (SPENDER, 100)));
    }

    function test_AerodromeSwap() public pure {
        FlashLoanArbitrage.Call memory call =
            CallBuilder.aerodromeSwap(ROUTER, 1000, 990, TOKEN, SPENDER, false, FACTORY, USER, 9999999999);

        IAerodromeRouter.Route[] memory routes = new IAerodromeRouter.Route[](1);
        routes[0] = IAerodromeRouter.Route({from: TOKEN, to: SPENDER, stable: false, factory: FACTORY});

        assertEq(call.target, ROUTER);
        assertEq(
            call.data,
            abi.encodeCall(IAerodromeRouter.swapExactTokensForTokens, (1000, 990, routes, USER, 9999999999))
        );
    }

    // --- Moonwell helpers ---

    function test_MoonwellLiquidateBorrow() public pure {
        FlashLoanArbitrage.Call memory call =
            CallBuilder.moonwellLiquidateBorrow(TOKEN, USER, 1000, SPENDER);
        assertEq(call.target, TOKEN); // the DEBT mToken
        assertEq(
            call.data, abi.encodeCall(IMoonwellMarket.liquidateBorrow, (USER, 1000, SPENDER))
        );
    }

    function test_MoonwellLiquidationLeg() public pure {
        FlashLoanArbitrage.Call[] memory calls =
            CallBuilder.moonwellLiquidationLeg(TOKEN, SPENDER, USER, 1000, ROUTER);
        assertEq(calls.length, 2);
        // [0] = approve(debtUnderlying -> mTokenDebt)
        assertEq(calls[0].target, TOKEN);
        assertEq(calls[0].data, abi.encodeCall(IERC20.approve, (SPENDER, 1000)));
        // [1] = liquidateBorrow on the debt mToken
        assertEq(calls[1].target, SPENDER);
        assertEq(calls[1].data, abi.encodeCall(IMoonwellMarket.liquidateBorrow, (USER, 1000, ROUTER)));
    }

    function test_MoonwellOevLiquidationLeg() public pure {
        FlashLoanArbitrage.Call[] memory calls =
            CallBuilder.moonwellOevLiquidationLeg(TOKEN, ROUTER, USER, 1000, POOL, SPENDER);
        assertEq(calls.length, 2);
        // [0] = approve(debtUnderlying -> OEV wrapper)
        assertEq(calls[0].target, TOKEN);
        assertEq(calls[0].data, abi.encodeCall(IERC20.approve, (ROUTER, 1000)));
        // [1] = updatePriceEarlyAndLiquidate(borrower, repay, mTokenCollateral, mTokenLoan)
        assertEq(calls[1].target, ROUTER);
        assertEq(
            calls[1].data,
            abi.encodeCall(IMoonwellOevWrapper.updatePriceEarlyAndLiquidate, (USER, 1000, POOL, SPENDER))
        );
    }

    function test_MoonwellRedeem() public pure {
        FlashLoanArbitrage.Call memory call = CallBuilder.moonwellRedeem(TOKEN, 500);
        assertEq(call.target, TOKEN);
        assertEq(call.data, abi.encodeCall(IMoonwellMarket.redeem, (500)));
    }

    function test_EstimateMoonwellSeizedUnderlying() public pure {
        // repay 1_000_000 USDC (6dp, $1.00), WETH price 3000e18, exchange rate
        // 1 mToken = 0.1 WETH (1e17), incentive 1.10e18, protocol share 0.03e18.
        //   grossSeizeTokens = 1e6 * 1e18 * 1.1e18 / (3000e18 * 1e17) = 3666 (floor)
        //   liquidatorSeizeTokens = 3666 * 0.97 = 3556 (floor)
        //   underlying seized = 3556 * 1e17 / 1e18 = 355 (floor)
        uint256 seized = CallBuilder.estimateMoonwellSeizedUnderlying(
            1_000_000,
            1e18, // debt price (USD, 18-dec)
            3000e18, // collateral price (USD, 18-dec)
            1e17, // exchange rate
            1.1e18, // liquidation incentive
            0.03e18 // protocol seize share
        );
        assertEq(seized, 355);
    }
}
