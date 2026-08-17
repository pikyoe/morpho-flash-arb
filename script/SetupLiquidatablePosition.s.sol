// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseAddresses} from "../src/BaseAddresses.sol";
import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";

interface IAavePoolMinimal {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)
        external;
    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );
}

interface IAaveOracleMinimal {
    function getSourceOfAsset(address asset) external view returns (address);
    function getAssetPrice(address asset) external view returns (uint256);
}

/// @notice LOCAL FORK TESTING ONLY. Constructs a real WETH-collateral /
///         USDC-debt position for a throwaway test address, then crashes the
///         WETH price feed on the local anvil node so the position becomes
///         liquidatable — giving watch.ts / checkPosition.ts something real
///         to find and act on, without touching mainnet or real funds.
///
/// Usage (against a running `anvil --fork-url <BASE_RPC_URL>`):
///   forge script script/SetupLiquidatablePosition.s.sol \
///     --rpc-url http://localhost:8545 \
///     --broadcast
contract SetupLiquidatablePosition is Script, StdCheats {
    // Deterministic throwaway key — NOT a real wallet, never fund this on
    // mainnet. Derived from a fixed seed purely so the script is reproducible.
    uint256 constant TEST_BORROWER_KEY = uint256(keccak256("morpho-flash-arb-test-borrower"));
    uint256 constant SUPPLY_AMOUNT = 5 ether; // 5 WETH as collateral
    uint256 constant PRICE_CRASH_BPS = 5000; // crash price by 50%

    function run() external {
        address testBorrower = vm.addr(TEST_BORROWER_KEY);
        console.log("Test borrower:", testBorrower);

        vm.deal(testBorrower, 1 ether); // gas
        deal(BaseAddresses.WETH, testBorrower, SUPPLY_AMOUNT);

        vm.startBroadcast(TEST_BORROWER_KEY);

        IERC20(BaseAddresses.WETH).approve(BaseAddresses.AAVE_V3_POOL, type(uint256).max);
        IAavePoolMinimal(BaseAddresses.AAVE_V3_POOL).supply(BaseAddresses.WETH, SUPPLY_AMOUNT, testBorrower, 0);

        (,, uint256 availableBorrowsBase,,,) =
            IAavePoolMinimal(BaseAddresses.AAVE_V3_POOL).getUserAccountData(testBorrower);

        // availableBorrowsBase is USD with 8 decimals; USDC has 6 decimals
        // and is ~$1 — so dividing by 100 converts scale, then take 95% of
        // the max to borrow as close to the LTV ceiling as safely possible.
        uint256 borrowUsdc = (availableBorrowsBase * 95) / 10_000;
        console.log("Borrowing USDC (raw, 6 decimals):", borrowUsdc);

        IAavePoolMinimal(BaseAddresses.AAVE_V3_POOL).borrow(BaseAddresses.USDC, borrowUsdc, 2, 0, testBorrower);

        vm.stopBroadcast();

        (,,,,, uint256 healthFactorBefore) =
            IAavePoolMinimal(BaseAddresses.AAVE_V3_POOL).getUserAccountData(testBorrower);
        console.log("Health factor after borrow:", healthFactorBefore);

        // --- Force health factor below 1.0 by crashing the WETH price feed ---
        address wethFeed = IAaveOracleMinimal(BaseAddresses.AAVE_V3_ORACLE).getSourceOfAsset(BaseAddresses.WETH);
        console.log("Real WETH price feed:", wethFeed);

        uint256 currentPrice = IAaveOracleMinimal(BaseAddresses.AAVE_V3_ORACLE).getAssetPrice(BaseAddresses.WETH);
        console.log("Current WETH price (8 decimals):", currentPrice);

        int256 crashedPrice = int256((currentPrice * (10_000 - PRICE_CRASH_BPS)) / 10_000);

        MockPriceFeed mock = new MockPriceFeed(crashedPrice);
        vm.etch(wethFeed, address(mock).code);
        // vm.etch only copies bytecode, not storage — write the price into
        // slot 0 directly (MockPriceFeed's only state variable).
        vm.store(wethFeed, bytes32(uint256(0)), bytes32(uint256(crashedPrice)));

        uint256 newPrice = IAaveOracleMinimal(BaseAddresses.AAVE_V3_ORACLE).getAssetPrice(BaseAddresses.WETH);
        console.log("New (crashed) WETH price:", newPrice);

        (,,,,, uint256 healthFactorAfter) =
            IAavePoolMinimal(BaseAddresses.AAVE_V3_POOL).getUserAccountData(testBorrower);
        console.log("Health factor after price crash:", healthFactorAfter);

        if (healthFactorAfter < 1e18) {
            console.log("SUCCESS: position is now liquidatable.");
            console.log("Test borrower address (use this in getPosition.ts / checkPosition.ts):");
            console.log(testBorrower);
        } else {
            console.log("Position still healthy - increase PRICE_CRASH_BPS or borrowed amount and re-run.");
        }
    }
}
