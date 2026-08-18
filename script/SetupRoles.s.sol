// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FlashLoanArbitrage} from "../src/FlashLoanArbitrage.sol";

/// @notice Post-deployment script to separate roles across dedicated wallets.
///         Run AFTER Deploy.s.sol — the admin key grants OPERATOR_ROLE and
///         PAUSER_ROLE to the specified addresses, then revokes them from itself.
/// @dev    Set env vars before running:
///         export ARBITRAGE_CONTRACT_ADDRESS=0x...
///         export OPERATOR_ADDRESS=0x...   # bot hot wallet
///         export PAUSER_ADDRESS=0x...     # emergency response address
///         forge script script/SetupRoles.s.sol:SetupRoles \
///           --rpc-url base \
///           --broadcast \
///           -vvvv
contract SetupRoles is Script {
    function run() external {
        uint256 adminKey = vm.envUint("PRIVATE_KEY");
        address arbAddress = vm.envAddress("ARBITRAGE_CONTRACT_ADDRESS");
        address operator = vm.envAddress("OPERATOR_ADDRESS");
        address pauser = vm.envAddress("PAUSER_ADDRESS");

        console.log("Admin:", vm.addr(adminKey));
        console.log("Contract:", arbAddress);
        console.log("Operator:", operator);
        console.log("Pauser:", pauser);

        FlashLoanArbitrage arb = FlashLoanArbitrage(arbAddress);
        bytes32 adminRole = arb.ADMIN_ROLE();
        bytes32 operatorRole = arb.OPERATOR_ROLE();
        bytes32 pauserRole = arb.PAUSER_ROLE();

        vm.startBroadcast(adminKey);

        // Grant OPERATOR_ROLE to the bot wallet
        arb.grantRole(operatorRole, operator);
        console.log("Granted OPERATOR_ROLE to:", operator);

        // Grant PAUSER_ROLE to the emergency response wallet
        arb.grantRole(pauserRole, pauser);
        console.log("Granted PAUSER_ROLE to:", pauser);

        // Revoke OPERATOR_ROLE from admin (defense-in-depth: admin shouldn't trade)
        arb.revokeRole(operatorRole, vm.addr(adminKey));
        console.log("Revoked OPERATOR_ROLE from admin");

        // Revoke PAUSER_ROLE from admin (pauser should be separate)
        arb.revokeRole(pauserRole, vm.addr(adminKey));
        console.log("Revoked PAUSER_ROLE from admin");

        vm.stopBroadcast();

        console.log("--- Role Setup Complete ---");
        console.log("Admin retains: DEFAULT_ADMIN_ROLE + ADMIN_ROLE");
        console.log("Operator has:  OPERATOR_ROLE (can execute arbitrage)");
        console.log("Pauser has:    PAUSER_ROLE (can pause in emergency)");
    }
}
