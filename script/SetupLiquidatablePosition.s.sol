// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseAddresses} from "../src/BaseAddresses.sol";
import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";
import {IMoonwellComptroller} from "../src/interfaces/IMoonwellComptroller.sol";

/// @notice Minimal Moonwell oracle interface for fork testing.
interface IMoonwellOracle {
    function getSourceOfAsset(address asset) external view returns (address);
    function getAssetPrice(address asset) external view returns (uint256);
}

/// @notice LOCAL FORK TESTING ONLY. Constructs a real WETH-collateral /
///         USDC-debt position on Moonwell (Base) for a throwaway test address,
///         then crashes the WETH Chainlink price feed so the position becomes
///         liquidatable.
///
/// Usage (against a running `anvil --fork-url <BASE_RPC_URL>`):
///   forge script script/SetupLiquidatablePosition.s.sol \
///     --rpc-url http://localhost:8545 \
///     --broadcast
contract SetupLiquidatablePosition is Script, StdCheats {
    uint256 constant TEST_BORROWER_KEY = uint256(keccak256("morpho-flash-arb-test-borrower"));
    uint256 constant SUPPLY_AMOUNT = 5 ether;
    uint256 constant PRICE_CRASH_BPS = 5000;

    function run() external {
        address testBorrower = vm.addr(TEST_BORROWER_KEY);
        console.log("Test borrower:", testBorrower);

        vm.deal(testBorrower, 1 ether);
        deal(BaseAddresses.WETH, testBorrower, SUPPLY_AMOUNT);

        _supplyWethAndBorrowUsdc(testBorrower);
        _crashPriceAndReport(testBorrower);
    }

    /// @dev Supply WETH collateral and borrow USDC via the test borrower.
    function _supplyWethAndBorrowUsdc(address borrower) internal {
        vm.startBroadcast(TEST_BORROWER_KEY);

        IERC20(BaseAddresses.WETH).approve(BaseAddresses.MOONWELL_M_WETH, type(uint256).max);
        (bool supplyOk,) = BaseAddresses.MOONWELL_M_WETH.call(
            abi.encodeWithSignature("mint(uint256)", SUPPLY_AMOUNT)
        );
        require(supplyOk, "mWETH.supply(mint) failed");
        console.log("Supplied", SUPPLY_AMOUNT, "WETH as collateral");

        (, uint256 liquidity,) = IMoonwellComptroller(BaseAddresses.MOONWELL_COMPTROLLER)
            .getAccountLiquidity(borrower);
        console.log("Available liquidity (USD, 18 dec):", liquidity);

        uint256 borrowUsdc = (liquidity * 95) / 10_000;
        console.log("Borrowing USDC (raw, 6 decimals):", borrowUsdc);

        IERC20(BaseAddresses.USDC).approve(BaseAddresses.MOONWELL_M_USDC, type(uint256).max);
        (bool borrowOk,) = BaseAddresses.MOONWELL_M_USDC.call(
            abi.encodeWithSignature("borrow(uint256)", borrowUsdc)
        );
        require(borrowOk, "mUSDC.borrow failed");

        vm.stopBroadcast();
    }

    /// @dev Crash WETH oracle price and report whether position is liquidatable.
    function _crashPriceAndReport(address borrower) internal {
        (, uint256 liqBefore, uint256 shortBefore) = IMoonwellComptroller(BaseAddresses.MOONWELL_COMPTROLLER)
            .getAccountLiquidity(borrower);
        console.log("Liquidity before crash:", liqBefore, "Shortfall:", shortBefore);

        IMoonwellOracle oracle = IMoonwellOracle(BaseAddresses.MOONWELL_CHAINLINK_ORACLE);
        address wethFeed = oracle.getSourceOfAsset(BaseAddresses.WETH);
        console.log("Real WETH Chainlink feed:", wethFeed);

        uint256 currentPrice = oracle.getAssetPrice(BaseAddresses.WETH);
        console.log("Current WETH price (8 decimals):", currentPrice);

        int256 crashedPrice = int256((currentPrice * (10_000 - PRICE_CRASH_BPS)) / 10_000);
        MockPriceFeed mock = new MockPriceFeed(crashedPrice);
        vm.etch(wethFeed, address(mock).code);
        vm.store(wethFeed, bytes32(uint256(0)), bytes32(uint256(crashedPrice)));

        uint256 newPrice = oracle.getAssetPrice(BaseAddresses.WETH);
        console.log("New (crashed) WETH price:", newPrice);

        (, uint256 liqAfter, uint256 shortAfter) = IMoonwellComptroller(BaseAddresses.MOONWELL_COMPTROLLER)
            .getAccountLiquidity(borrower);
        console.log("Liquidity after crash:", liqAfter, "Shortfall:", shortAfter);

        if (shortAfter > 0) {
            console.log("SUCCESS: position is now liquidatable.");
            console.log("Test borrower address:");
            console.log(borrower);
            console.log("Debt: USDC, Collateral: WETH");
        } else {
            console.log("Position still healthy -- increase PRICE_CRASH_BPS or borrowed amount and re-run.");
        }
    }
}
