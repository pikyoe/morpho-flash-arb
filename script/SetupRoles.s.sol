// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FlashLoanArbitrage} from "../src/FlashLoanArbitrage.sol";

/// @notice Sets up role-based access control for a deployed FlashLoanArbitrage contract.
/// This script demonstrates best practices for production deployment:
/// - Separate admin, operator, and pauser roles
/// - Never use the same address for all roles in production
/// Usage:
///   forge script script/SetupRoles.s.sol:SetupRoles \
///     --rpc-url base \
///     --broadcast \
///     -vvvv
/// Requires:
///   - PRIVATE_KEY (admin with all roles)
///   - OPERATOR_ADDRESS (bot address for executing arbitrage)
///   - PAUSER_ADDRESS (emergency address for pausing)
///   - ARBITRAGE_CONTRACT_ADDRESS (deployed contract address)
contract SetupRoles is Script {
    function run() external {
        uint256 adminKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.addr(adminKey);
        
        address operatorAddress = vm.envAddress("OPERATOR_ADDRESS");
        address pauserAddress = vm.envAddress("PAUSER_ADDRESS");
        address arbContractAddress = vm.envAddress("ARBITRAGE_CONTRACT_ADDRESS");
        
        FlashLoanArbitrage arb = FlashLoanArbitrage(arbContractAddress);

        vm.startBroadcast(adminKey);

        // Grant OPERATOR_ROLE to the bot address (can execute arbitrage)
        arb.grantRole(arb.OPERATOR_ROLE(), operatorAddress);
        
        // Grant PAUSER_ROLE to the emergency address (can pause in emergencies)
        arb.grantRole(arb.PAUSER_ROLE(), pauserAddress);
        
        // Keep ADMIN_ROLE with the admin (can manage roles and withdraw)
        // Admin retains DEFAULT_ADMIN_ROLE by default

        vm.stopBroadcast();

        console.log("Role setup completed for contract:", arbContractAddress);
        console.log("Admin:", admin);
        console.log("Operator (arbitrage execution):", operatorAddress);
        console.log("Pauser (emergency):", pauserAddress);
        
        console.log("\nRole assignments:");
        console.log("- ADMIN_ROLE:", admin);
        console.log("- OPERATOR_ROLE:", operatorAddress);
        console.log("- PAUSER_ROLE:", pauserAddress);
        
        console.log("\nIMPORTANT SECURITY NOTES:");
        console.log("- Admin can grant/revoke all roles");
        console.log("- Operator can only execute arbitrage, not withdraw or pause");
        console.log("- Pauser can only pause, not execute or withdraw");
        console.log("- Use hardware wallets for admin and pauser addresses");
        console.log("- Consider using multisig for admin role in production");
    }
}