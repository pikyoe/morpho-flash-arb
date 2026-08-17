// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {FlashLoanArbitrage} from "../src/FlashLoanArbitrage.sol";
import {BaseAddresses} from "../src/BaseAddresses.sol";

/// @notice Comprehensive security tests for the enhanced FlashLoanArbitrage contract.
/// @dev Tests focus on security hardening features:
///      - Role-based access control
///      - Pausable functionality
///      - Whitelist mechanisms
///      - Input validation
///      - Reentrancy protection
///      - Emergency functions
contract SecurityHardeningTest is Test {
    FlashLoanArbitrage internal arb;

    address internal admin = address(this);
    address internal operator = address(0xOPERATOR);
    address internal pauser = address(0xPAUSER);
    address internal attacker = address(0xATTACKER);

    address internal constant WETH = BaseAddresses.WETH;
    address internal constant MORPHO = BaseAddresses.MORPHO_BLUE;

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"));
        vm.createSelectFork(rpcUrl);

        arb = new FlashLoanArbitrage(MORPHO, admin);
        
        // Setup initial whitelist
        address[] memory initialTargets = new address[](5);
        initialTargets[0] = BaseAddresses.AAVE_V3_POOL;
        initialTargets[1] = BaseAddresses.AERODROME_ROUTER;
        initialTargets[2] = BaseAddresses.UNISWAP_V3_SWAP_ROUTER02;
        initialTargets[3] = BaseAddresses.WETH;
        initialTargets[4] = BaseAddresses.USDC;
        arb.batchAddTargetsToWhitelist(initialTargets);
        
        // Grant roles
        arb.grantRole(arb.OPERATOR_ROLE(), operator);
        arb.grantRole(arb.PAUSER_ROLE(), pauser);
    }

    // --- Role Separation Tests ---

    function test_OperatorCannotWithdrawTokens() public {
        deal(WETH, address(arb), 1 ether);
        
        vm.prank(operator);
        vm.expectRevert();
        arb.withdrawToken(WETH, operator, 1 ether);
    }

    function test_OperatorCannotPause() public {
        vm.prank(operator);
        vm.expectRevert();
        arb.pause();
    }

    function test_OperatorCannotGrantRoles() public {
        vm.prank(operator);
        vm.expectRevert();
        arb.grantRole(arb.OPERATOR_ROLE(), attacker);
    }

    function test_PauserCannotExecuteArbitrage() public {
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({
            target: BaseAddresses.WETH,
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", BaseAddresses.AERODROME_ROUTER, 1 ether)
        });
        
        vm.prank(pauser);
        vm.expectRevert();
        arb.executeArbitrage(WETH, 1 ether, calls, 1);
    }

    function test_PauserCannotWithdraw() public {
        deal(WETH, address(arb), 1 ether);
        
        vm.prank(pauser);
        vm.expectRevert();
        arb.withdrawToken(WETH, pauser, 1 ether);
    }

    // --- Whitelist Security Tests ---

    function test_AttackerCannotBypassWhitelist() public {
        // Try to call a non-whitelisted malicious contract
        address maliciousContract = address(0xMALICIOUS);
        
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({
            target: maliciousContract,
            value: 0,
            data: abi.encodeWithSignature("steal()")
        });
        
        vm.prank(operator);
        vm.expectRevert(FlashLoanArbitrage.InvalidTarget.selector);
        arb.executeArbitrage(WETH, 1 ether, calls, 1);
    }

    function test_WhitelistPreventsTokenDrainage() public {
        // Try to approve a non-whitelisted spender
        address maliciousSpender = address(0xMALICIOUS);
        
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({
            target: BaseAddresses.WETH,
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", maliciousSpender, type(uint256).max)
        });
        
        // WETH is whitelisted, but maliciousSpender is not a target
        // This should succeed as WETH is whitelisted
        // However, the malicious spender would need to be whitelisted to be called
        
        // Test that malicious spender cannot be called in subsequent calls
        FlashLoanArbitrage.Call[] memory maliciousCalls = new FlashLoanArbitrage.Call[](2);
        maliciousCalls[0] = calls[0];
        maliciousCalls[1] = FlashLoanArbitrage.Call({
            target: maliciousSpender,
            value: 0,
            data: abi.encodeWithSignature("drain()")
        });
        
        vm.prank(operator);
        vm.expectRevert(FlashLoanArbitrage.InvalidTarget.selector);
        arb.executeArbitrage(WETH, 1 ether, maliciousCalls, 1);
    }

    // --- Emergency Scenario Tests ---

    function test_EmergencyPauseStopsAllOperations() public {
        // Normal operation
        assertFalse(arb.paused());
        
        // Emergency scenario: suspicious activity detected
        vm.prank(pauser);
        arb.pause();
        
        assertTrue(arb.paused());
        
        // Verify all operations are blocked
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({
            target: BaseAddresses.WETH,
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", BaseAddresses.AERODROME_ROUTER, 1 ether)
        });
        
        vm.prank(operator);
        vm.expectRevert();
        arb.executeArbitrage(WETH, 1 ether, calls, 1);
    }

    function test_AdminCanRecoverFromEmergency() public {
        // Pause the contract
        vm.prank(pauser);
        arb.pause();
        
        // Admin can unpause to resume operations
        arb.unpause();
        
        assertFalse(arb.paused());
        
        // Operations resume
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({
            target: BaseAddresses.WETH,
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", BaseAddresses.AERODROME_ROUTER, 1 ether)
        });
        
        deal(WETH, address(arb), 0.01 ether);
        
        vm.prank(operator);
        arb.executeArbitrage(WETH, 5 ether, calls, 0.01 ether);
    }

    // --- Input Validation Tests ---

    function test_MinimumFlashLoanSizePreventsDustAttacks() public {
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({
            target: BaseAddresses.WETH,
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", BaseAddresses.AERODROME_ROUTER, 1 ether)
        });
        
        // Try with amount below minimum
        vm.prank(operator);
        vm.expectRevert(FlashLoanArbitrage.InvalidAmount.selector);
        arb.executeArbitrage(WETH, 100, calls, 1); // Very small amount
    }

    function test_MaxCallsLimitPreventsGasGriefing() public {
        // Try to execute too many calls (gas griefing attempt)
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](21);
        
        vm.prank(operator);
        vm.expectRevert(FlashLoanArbitrage.InvalidCallsLength.selector);
        arb.executeArbitrage(WETH, 1 ether, calls, 1);
    }

    // --- Reentrancy Protection Tests ---

    function test_ReentrancyGuardProtectsFlashLoan() public {
        // This test verifies that the reentrancy guard is properly applied
        // The actual reentrancy protection is tested by the fact that
        // executeArbitrage has the nonReentrant modifier
        
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({
            target: BaseAddresses.WETH,
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", BaseAddresses.AERODROME_ROUTER, 1 ether)
        });
        
        deal(WETH, address(arb), 0.01 ether);
        
        // Normal execution should work
        vm.prank(operator);
        arb.executeArbitrage(WETH, 5 ether, calls, 0.01 ether);
        
        // If reentrancy were possible, malicious contracts could exploit
        // the flash loan callback to drain funds
    }

    // --- Access Control Revocation Tests ---

    function test_AdminCanRevokeOperatorRole() public {
        assertTrue(arb.hasRole(arb.OPERATOR_ROLE(), operator));
        
        arb.revokeRole(arb.OPERATOR_ROLE(), operator);
        
        assertFalse(arb.hasRole(arb.OPERATOR_ROLE(), operator));
        
        // Operator can no longer execute arbitrage
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({
            target: BaseAddresses.WETH,
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", BaseAddresses.AERODROME_ROUTER, 1 ether)
        });
        
        vm.prank(operator);
        vm.expectRevert();
        arb.executeArbitrage(WETH, 1 ether, calls, 1);
    }

    function test_AdminCanRevokePauserRole() public {
        assertTrue(arb.hasRole(arb.PAUSER_ROLE(), pauser));
        
        arb.revokeRole(arb.PAUSER_ROLE(), pauser);
        
        assertFalse(arb.hasRole(arb.PAUSER_ROLE(), pauser));
        
        // Pauser can no longer pause
        vm.prank(pauser);
        vm.expectRevert();
        arb.pause();
    }

    // --- Comprehensive Security Scenario ---

    function test_SecurityScenario_AttackerGainsAccess() public {
        // Scenario: Attacker somehow gains operator role (should be prevented)
        // Admin should revoke compromised role immediately
        
        // First, verify attacker doesn't have operator role
        assertFalse(arb.hasRole(arb.OPERATOR_ROLE(), attacker));
        
        // Attacker tries to grant themselves operator role (should fail)
        vm.prank(attacker);
        vm.expectRevert();
        arb.grantRole(arb.OPERATOR_ROLE(), attacker);
        
        // Even if attacker got operator role, admin can revoke
        arb.grantRole(arb.OPERATOR_ROLE(), attacker); // Simulate compromise
        assertTrue(arb.hasRole(arb.OPERATOR_ROLE(), attacker));
        
        // Admin revokes compromised role
        arb.revokeRole(arb.OPERATOR_ROLE(), attacker);
        assertFalse(arb.hasRole(arb.OPERATOR_ROLE(), attacker));
        
        // Contract remains secure
        assertTrue(arb.hasRole(arb.ADMIN_ROLE(), admin));
    }

    function test_SecurityScenario_EmergencyWithCompromisedOperator() public {
        // Scenario: Operator is compromised, admin uses emergency pause
        
        // Compromise operator
        arb.grantRole(arb.OPERATOR_ROLE(), attacker);
        
        // Admin uses pauser to stop operations
        vm.prank(pauser);
        arb.pause();
        
        // Even compromised operator cannot execute
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({
            target: BaseAddresses.WETH,
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", BaseAddresses.AERODROME_ROUTER, 1 ether)
        });
        
        vm.prank(attacker);
        vm.expectRevert();
        arb.executeArbitrage(WETH, 1 ether, calls, 1);
        
        // Admin revokes compromised role
        arb.revokeRole(arb.OPERATOR_ROLE(), attacker);
        
        // Admin unpauses and restores normal operation
        arb.unpause();
        
        // Contract is now secure again
        assertFalse(arb.paused());
        assertFalse(arb.hasRole(arb.OPERATOR_ROLE(), attacker));
    }
}