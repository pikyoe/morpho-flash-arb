// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FlashLoanArbitrage} from "../src/FlashLoanArbitrage.sol";
import {BaseAddresses} from "../src/BaseAddresses.sol";

/// @notice Forge deployment script for FlashLoanArbitrage on Base mainnet.
///         Deploys the contract with the deployer as initial admin (all roles),
///         whitelists every target the Moonwell + Aerodrome route needs,
///         and configures per-asset min/max flash loan sizes from env vars.
/// @dev    Required env vars:
///           PRIVATE_KEY             - deployer private key
///           MIN_FLASH_LOAN_USDC     - minimum flash loan for USDC (in USDC units, e.g. 1000 for 1000 USDC)
///           MAX_FLASH_LOAN_USDC     - maximum flash loan for USDC (0 = no limit)
///           MIN_FLASH_LOAN_WETH     - minimum flash loan for WETH (in wei, e.g. 0.1e18)
///           MAX_FLASH_LOAN_WETH     - maximum flash loan for WETH (0 = no limit)
///           MIN_FLASH_LOAN_CBETH    - minimum flash loan for CBETH (in wei)
///           MAX_FLASH_LOAN_CBETH    - maximum flash loan for CBETH (0 = no limit)
///           MIN_FLASH_LOAN_WSTETH   - minimum flash loan for WSTETH (in wei)
///           MAX_FLASH_LOAN_WSTETH   - maximum flash loan for WSTETH (0 = no limit)
///           MIN_FLASH_LOAN_CBBTC    - minimum flash loan for CBBTC (in satoshis, e.g. 0.01e8)
///           MAX_FLASH_LOAN_CBBTC    - maximum flash loan for CBBTC (0 = no limit)
///           MIN_FLASH_LOAN_AERO     - minimum flash loan for AERO (in wei)
///           MAX_FLASH_LOAN_AERO     - maximum flash loan for AERO (0 = no limit)
///
///         Run:
///         forge script script/Deploy.s.sol:Deploy \
///           --rpc-url base \
///           --broadcast \
///           --verify \
///           -vvvv
contract Deploy is Script {
    function run() public {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deployer:", deployer);
        console.log("Morpho Blue:", BaseAddresses.MORPHO_BLUE);

        vm.startBroadcast(deployerKey);

        // 1. Deploy with deployer as initial admin (receives all roles)
        FlashLoanArbitrage arb = new FlashLoanArbitrage(
            BaseAddresses.MORPHO_BLUE,
            deployer
        );
        console.log("FlashLoanArbitrage deployed at:", address(arb));

        // 2. Whitelist all targets needed for the standard Moonwell liquidation route
        address[] memory targets = new address[](8);
        uint256 i = 0;

        // --- Moonwell mToken markets (debt + collateral) ---
        targets[i++] = BaseAddresses.MOONWELL_M_USDC;
        targets[i++] = BaseAddresses.MOONWELL_M_WETH;
        targets[i++] = BaseAddresses.MOONWELL_M_CBETH;
        targets[i++] = BaseAddresses.MOONWELL_M_WSTETH;
        targets[i++] = BaseAddresses.MOONWELL_M_AERO;
        targets[i++] = BaseAddresses.MOONWELL_M_CBBTC;

        // --- DEX routers ---
        targets[i++] = BaseAddresses.AERODROME_ROUTER;
        targets[i++] = BaseAddresses.UNISWAP_V3_SWAP_ROUTER02;

        arb.batchAddTargetsToWhitelist(targets);

        // 3. Whitelist token contracts (needed for approve calls in the route)
        address[] memory tokens = new address[](6);
        tokens[0] = BaseAddresses.USDC;
        tokens[1] = BaseAddresses.WETH;
        tokens[2] = BaseAddresses.CBETH;
        tokens[3] = BaseAddresses.WSTETH;
        tokens[4] = BaseAddresses.CBBTC;
        tokens[5] = BaseAddresses.AERO;

        arb.batchAddTargetsToWhitelist(tokens);

        // 4. Whitelist the OEV wrapper (for the competitive OEV path)
        arb.addTargetToWhitelist(BaseAddresses.MOONWELL_OEV_WRAPPER_WETH);

        // 5. Configure per-asset min/max flash loan sizes from env vars
        _configureFlashLoanLimits(arb);

        vm.stopBroadcast();

        console.log("--- Deployment Complete ---");
        console.log("Contract:", address(arb));
        console.log("Admin/Operator/Pauser:", deployer);
        console.log("Whitelisted targets:", uint256(8 + 6 + 1));
        console.log("");
        console.log("Next steps:");
        console.log("1. Run SetupRoles.s.sol to separate OPERATOR/PAUSER to dedicated wallets");
        console.log("2. Set ARBITRAGE_CONTRACT_ADDRESS in bot/.env");
        console.log("3. Keep LIVE_EXECUTION=false until dry-run looks correct");
    }

    /// @dev Reads MIN/MAX flash loan sizes from env vars and sets them on the contract.
    ///      If an env var is not set, the asset is skipped (uses DEFAULT_MIN_FLASH_LOAN_SIZE).
    function _configureFlashLoanLimits(FlashLoanArbitrage arb) internal {
        // USDC (6 decimals)
        _trySetMinMax(arb, BaseAddresses.USDC, "USDC", 6);

        // WETH (18 decimals)
        _trySetMinMax(arb, BaseAddresses.WETH, "WETH", 18);

        // CBETH (18 decimals)
        _trySetMinMax(arb, BaseAddresses.CBETH, "CBETH", 18);

        // WSTETH (18 decimals)
        _trySetMinMax(arb, BaseAddresses.WSTETH, "WSTETH", 18);

        // CBBTC (8 decimals)
        _trySetMinMax(arb, BaseAddresses.CBBTC, "CBBTC", 8);

        // AERO (18 decimals)
        _trySetMinMax(arb, BaseAddresses.AERO, "AERO", 18);
    }

    /// @dev Tries to read MIN/MAX env vars for an asset. If env var is set, calls the contract.
    function _trySetMinMax(FlashLoanArbitrage arb, address asset, string memory symbol, uint8 decimals) internal {
        string memory minEnv = string.concat("MIN_FLASH_LOAN_", symbol);
        string memory maxEnv = string.concat("MAX_FLASH_LOAN_", symbol);

        // Try to read min
        try vm.envUint(minEnv) returns (uint256 minVal) {
            if (minVal > 0) {
                arb.setMinimumFlashLoanSize(asset, minVal);
                console.log("  Set min flash loan for %s: %d", symbol, minVal);
            }
        } catch {
            // Env var not set — skip, uses DEFAULT_MIN_FLASH_LOAN_SIZE
        }

        // Try to read max
        try vm.envUint(maxEnv) returns (uint256 maxVal) {
            if (maxVal > 0) {
                arb.setMaximumFlashLoanSize(asset, maxVal);
                console.log("  Set max flash loan for %s: %d", symbol, maxVal);
            }
        } catch {
            // Env var not set — skip, no max limit
        }
    }
}
