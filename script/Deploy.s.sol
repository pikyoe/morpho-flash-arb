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

        // Setup initial whitelist of trusted target contracts for the Moonwell
        // liquidation route (see README "Moonwell liquidation"):
        //  - the debt mToken (liquidateBorrow is called on it),
        //  - the debt + collateral UNDERLYING tokens (approve calls),
        //  - the DEX routers (the swap).
        // NOTE: for the OEV path also whitelist the ChainlinkOEVWrapper and the
        // collateral mToken (redeem call). Any extra collateral asset the bot
        // liquidates must be whitelisted too (the route approves that token
        // before the DEX swap) — add more via addTargetToWhitelist after deploying.
        address[] memory initialTargets = new address[](9);
        initialTargets[0] = BaseAddresses.MOONWELL_M_USDC;
        initialTargets[1] = BaseAddresses.MOONWELL_M_WETH;
        initialTargets[2] = BaseAddresses.AERODROME_ROUTER;
        initialTargets[3] = BaseAddresses.UNISWAP_V3_SWAP_ROUTER02;
        initialTargets[4] = BaseAddresses.WETH;
        initialTargets[5] = BaseAddresses.USDC;
        initialTargets[6] = BaseAddresses.CBETH;
        initialTargets[7] = BaseAddresses.WSTETH;
        initialTargets[8] = BaseAddresses.CBBTC;
        
        arb.batchAddTargetsToWhitelist(initialTargets);

        vm.stopBroadcast();

        console.log("FlashLoanArbitrage deployed at:", address(arb));
        console.log("Admin:", deployer);
        console.log("Morpho Blue:", BaseAddresses.MORPHO_BLUE);
        console.log("Initial targets whitelisted:", initialTargets.length);
        console.log("Moonwell Comptroller:", BaseAddresses.MOONWELL_COMPTROLLER);
        console.log("Moonwell mUSDC/mWETH markets:", BaseAddresses.MOONWELL_M_USDC, "/", BaseAddresses.MOONWELL_M_WETH);
        
        console.log("\nIMPORTANT SECURITY NOTES:");
        console.log("- Admin has all roles (ADMIN, OPERATOR, PAUSER)");
        console.log("- Consider granting OPERATOR_ROLE to a separate bot address");
        console.log("- Consider granting PAUSER_ROLE to a separate emergency address");
        console.log("- Only whitelisted contracts can be called in arbitrage routes");
        console.log("- Contract is initially unpaused; use pause() for emergency stops");
    }
}
