// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FlashLoanArbitrage} from "../src/FlashLoanArbitrage.sol";
import {BaseAddresses} from "../src/BaseAddresses.sol";

/// @notice Forge deployment script for FlashLoanArbitrage on Base mainnet.
///         Deploys the contract with the deployer as initial admin (all roles),
///         then whitelists every target the Moonwell + Aerodrome route needs.
/// @dev    Run:
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
}
