// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {CallBuilder} from "../src/libraries/CallBuilder.sol";
import {FlashLoanArbitrage} from "../src/FlashLoanArbitrage.sol";
import {IAerodromeRouter} from "../src/interfaces/IAerodromeRouter.sol";
import {IAaveV3Pool} from "../src/interfaces/IAaveV3Pool.sol";

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

    function test_AaveSupply() public pure {
        FlashLoanArbitrage.Call memory call = CallBuilder.aaveSupply(POOL, TOKEN, 500, USER);
        assertEq(call.target, POOL);
        assertEq(call.data, abi.encodeCall(IAaveV3Pool.supply, (TOKEN, 500, USER, 0)));
    }

    function test_AaveWithdraw() public pure {
        FlashLoanArbitrage.Call memory call = CallBuilder.aaveWithdraw(POOL, TOKEN, 500, USER);
        assertEq(call.target, POOL);
        assertEq(call.data, abi.encodeCall(IAaveV3Pool.withdraw, (TOKEN, 500, USER)));
    }

    function test_AaveLiquidationCall() public pure {
        FlashLoanArbitrage.Call memory call =
            CallBuilder.aaveLiquidationCall(POOL, TOKEN, SPENDER, USER, 1000, false);
        assertEq(call.target, POOL);
        assertEq(
            call.data, abi.encodeCall(IAaveV3Pool.liquidationCall, (TOKEN, SPENDER, USER, 1000, false))
        );
    }
}
