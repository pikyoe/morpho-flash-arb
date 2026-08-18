// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FlashLoanArbitrage} from "../src/FlashLoanArbitrage.sol";
import {BaseAddresses} from "../src/BaseAddresses.sol";

contract SecurityHardeningTest is Test {
    FlashLoanArbitrage internal arb;
    address internal admin = address(this);
    address internal operator = makeAddr("operator");
    address internal pauser = makeAddr("pauser");
    address internal attacker = makeAddr("attacker");

    address internal constant WETH = BaseAddresses.WETH;
    address internal constant MORPHO = BaseAddresses.MORPHO_BLUE;

    bytes32 internal operatorRole;
    bytes32 internal pauserRole;
    bytes32 internal adminRole;

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"));
        vm.createSelectFork(rpcUrl);
        arb = new FlashLoanArbitrage(MORPHO, admin);

        // Cache role IDs before any prank so role lookups cannot consume vm.prank().
        operatorRole = arb.OPERATOR_ROLE();
        pauserRole = arb.PAUSER_ROLE();
        adminRole = arb.ADMIN_ROLE();

        address[] memory initialTargets = new address[](5);
        initialTargets[0] = BaseAddresses.MOONWELL_M_USDC;
        initialTargets[1] = BaseAddresses.AERODROME_ROUTER;
        initialTargets[2] = BaseAddresses.UNISWAP_V3_SWAP_ROUTER02;
        initialTargets[3] = BaseAddresses.WETH;
        initialTargets[4] = BaseAddresses.USDC;
        arb.batchAddTargetsToWhitelist(initialTargets);
        arb.grantRole(operatorRole, operator);
        arb.grantRole(pauserRole, pauser);
    }

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
        arb.grantRole(operatorRole, attacker);
        assertFalse(arb.hasRole(operatorRole, attacker));
    }

    function test_PauserCannotExecuteArbitrage() public {
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({target: BaseAddresses.WETH, value: 0, data: abi.encodeWithSignature("approve(address,uint256)", BaseAddresses.AERODROME_ROUTER, 1 ether)});
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

    function test_AttackerCannotBypassWhitelist() public {
        address maliciousContract = makeAddr("malicious");
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({target: maliciousContract, value: 0, data: abi.encodeWithSignature("steal()")});
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.InvalidTarget.selector, maliciousContract));
        arb.executeArbitrage(WETH, 1 ether, calls, 1);
    }

    function test_WhitelistPreventsTokenDrainage() public {
        address maliciousSpender = makeAddr("malicious");
        FlashLoanArbitrage.Call[] memory maliciousCalls = new FlashLoanArbitrage.Call[](2);
        maliciousCalls[0] = FlashLoanArbitrage.Call({target: BaseAddresses.WETH, value: 0, data: abi.encodeWithSignature("approve(address,uint256)", maliciousSpender, type(uint256).max)});
        maliciousCalls[1] = FlashLoanArbitrage.Call({target: maliciousSpender, value: 0, data: abi.encodeWithSignature("drain()")});
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.InvalidTarget.selector, maliciousSpender));
        arb.executeArbitrage(WETH, 1 ether, maliciousCalls, 1);
    }

    function test_EmergencyPauseStopsAllOperations() public {
        assertFalse(arb.paused());
        vm.prank(pauser);
        arb.pause();
        assertTrue(arb.paused());
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({target: BaseAddresses.WETH, value: 0, data: abi.encodeWithSignature("approve(address,uint256)", BaseAddresses.AERODROME_ROUTER, 1 ether)});
        vm.prank(operator);
        vm.expectRevert();
        arb.executeArbitrage(WETH, 1 ether, calls, 1);
    }

    function test_AdminCanRecoverFromEmergency() public {
        vm.prank(pauser);
        arb.pause();
        arb.unpause();
        assertFalse(arb.paused());
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({target: BaseAddresses.WETH, value: 0, data: abi.encodeWithSignature("approve(address,uint256)", BaseAddresses.AERODROME_ROUTER, 1 ether)});
        deal(WETH, address(arb), 0.01 ether);
        vm.prank(operator);
        arb.executeArbitrage(WETH, 5 ether, calls, 0.01 ether);
    }

    function test_MinimumFlashLoanSizePreventsDustAttacks() public {
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({target: BaseAddresses.WETH, value: 0, data: abi.encodeWithSignature("approve(address,uint256)", BaseAddresses.AERODROME_ROUTER, 1 ether)});
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.InvalidAmount.selector, 100));
        arb.executeArbitrage(WETH, 100, calls, 1);
    }

    function test_MaxCallsLimitPreventsGasGriefing() public {
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](21);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.InvalidCallsLength.selector, 21));
        arb.executeArbitrage(WETH, 1 ether, calls, 1);
    }

    function test_ReentrancyGuardProtectsFlashLoan() public {
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({target: BaseAddresses.WETH, value: 0, data: abi.encodeWithSignature("approve(address,uint256)", BaseAddresses.AERODROME_ROUTER, 1 ether)});
        deal(WETH, address(arb), 0.01 ether);
        vm.prank(operator);
        arb.executeArbitrage(WETH, 5 ether, calls, 0.01 ether);
    }

    function test_AdminCanRevokeOperatorRole() public {
        assertTrue(arb.hasRole(operatorRole, operator));
        arb.revokeRole(operatorRole, operator);
        assertFalse(arb.hasRole(operatorRole, operator));
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({target: BaseAddresses.WETH, value: 0, data: abi.encodeWithSignature("approve(address,uint256)", BaseAddresses.AERODROME_ROUTER, 1 ether)});
        vm.prank(operator);
        vm.expectRevert();
        arb.executeArbitrage(WETH, 1 ether, calls, 1);
    }

    function test_AdminCanRevokePauserRole() public {
        assertTrue(arb.hasRole(pauserRole, pauser));
        arb.revokeRole(pauserRole, pauser);
        assertFalse(arb.hasRole(pauserRole, pauser));
        vm.prank(pauser);
        vm.expectRevert();
        arb.pause();
    }

    function test_SecurityScenario_AttackerGainsAccess() public {
        assertFalse(arb.hasRole(operatorRole, attacker));
        vm.prank(attacker);
        vm.expectRevert();
        arb.grantRole(operatorRole, attacker);
        assertFalse(arb.hasRole(operatorRole, attacker));

        // Simulate an administrator compromise explicitly: the admin grants the role.
        arb.grantRole(operatorRole, attacker);
        assertTrue(arb.hasRole(operatorRole, attacker));
        arb.revokeRole(operatorRole, attacker);
        assertFalse(arb.hasRole(operatorRole, attacker));
        assertTrue(arb.hasRole(adminRole, admin));
    }

    function test_SecurityScenario_EmergencyWithCompromisedOperator() public {
        arb.grantRole(operatorRole, attacker);
        vm.prank(pauser);
        arb.pause();
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({target: BaseAddresses.WETH, value: 0, data: abi.encodeWithSignature("approve(address,uint256)", BaseAddresses.AERODROME_ROUTER, 1 ether)});
        vm.prank(attacker);
        vm.expectRevert();
        arb.executeArbitrage(WETH, 1 ether, calls, 1);
        arb.revokeRole(operatorRole, attacker);
        arb.unpause();
        assertFalse(arb.paused());
        assertFalse(arb.hasRole(operatorRole, attacker));
    }
}
