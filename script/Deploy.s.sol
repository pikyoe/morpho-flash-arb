// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FlashLoanArbitrage} from "../src/FlashLoanArbitrage.sol";
import {BaseAddresses} from "../src/BaseAddresses.sol";

/// @notice Deploys FlashLoanArbitrage to Base with security-enhanced configuration.
/// Usage:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url base \
///     --broadcast \
///     --verify \
///     -vvvv
/// Requires PRIVATE_KEY (deployer/admin) in your .env — see .env.example.
contract Deploy is Script {
    function run() external returns (FlashLoanArbitrage arb) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // Deploy with enhanced security features
        arb = new FlashLoanArbitrage(BaseAddresses.MORPHO_BLUE, deployer);

        // Setup initial whitelist of trusted target contracts
        address[] memory initialTargets = new address[](5);
        initialTargets[0] = BaseAddresses.AAVE_V3_POOL;
        initialTargets[1] = BaseAddresses.AERODROME_ROUTER;
        initialTargets[2] = BaseAddresses.UNISWAP_V3_SWAP_ROUTER02;
        initialTargets[3] = BaseAddresses.WETH;
        initialTargets[4] = BaseAddresses.USDC;
        
        arb.batchAddTargetsToWhitelist(initialTargets);

        vm.stopBroadcast();

        console.log("FlashLoanArbitrage deployed at:", address(arb));
        console.log("Admin:", deployer);
        console.log("Morpho Blue:", BaseAddresses.MORPHO_BLUE);
        console.log("Initial targets whitelisted:", initialTargets.length);
        
        console.log("\nIMPORTANT SECURITY NOTES:");
        console.log("- Admin has all roles (ADMIN, OPERATOR, PAUSER)");
        console.log("- Consider granting OPERATOR_ROLE to a separate bot address");
        console.log("- Consider granting PAUSER_ROLE to a separate emergency address");
        console.log("- Only whitelisted contracts can be called in arbitrage routes");
        console.log("- Contract is initially unpaused; use pause() for emergency stops");
    }
}
