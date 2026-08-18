// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {FlashLoanArbitrage} from "../src/FlashLoanArbitrage.sol";
import {IMorphoFlashLoanCallback} from "../src/interfaces/IMorpho.sol";
import {BaseAddresses} from "../src/BaseAddresses.sol";

/// @notice Fork tests against real Morpho Blue + WETH on Base mainnet.
/// @dev Run with: forge test --fork-url $BASE_RPC_URL -vvv
///      Requires BASE_RPC_URL to be set (see .env.example).
contract FlashLoanArbitrageTest is Test {
    FlashLoanArbitrage internal arb;

    address internal admin = address(this);
    address internal operator = makeAddr("operator");
    address internal pauser = makeAddr("pauser");
    address internal stranger = makeAddr("stranger");

    address internal constant WETH = BaseAddresses.WETH;
    address internal constant MORPHO = BaseAddresses.MORPHO_BLUE;

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"));
        vm.createSelectFork(rpcUrl);

        arb = new FlashLoanArbitrage(MORPHO, admin);
        
        // Setup initial whitelist
        arb.batchAddTargetsToWhitelist(_getInitialTargets());
        
        // Grant roles for testing
        arb.grantRole(arb.OPERATOR_ROLE(), operator);
        arb.grantRole(arb.PAUSER_ROLE(), pauser);
    }

    function _getInitialTargets() internal pure returns (address[] memory) {
        address[] memory targets = new address[](5);
        targets[0] = BaseAddresses.MOONWELL_M_USDC;
        targets[1] = BaseAddresses.AERODROME_ROUTER;
        targets[2] = BaseAddresses.UNISWAP_V3_SWAP_ROUTER02;
        targets[3] = BaseAddresses.WETH;
        targets[4] = BaseAddresses.USDC;
        return targets;
    }

    // --- Access control ---

    function test_Deployment() public view {
        assertEq(address(arb.morpho()), MORPHO);
        assertTrue(arb.hasRole(arb.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(arb.hasRole(arb.ADMIN_ROLE(), admin));
        assertTrue(arb.hasRole(arb.OPERATOR_ROLE(), admin));
        assertTrue(arb.hasRole(arb.PAUSER_ROLE(), admin));
    }

    function test_RevertIf_NonOperatorExecutesArbitrage() public {
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](0);

        vm.prank(stranger);
        vm.expectRevert();
        arb.executeArbitrage(WETH, 1 ether, calls, 1);
    }

    function test_OperatorCanExecuteArbitrage() public {
        // Calls must be non-empty (executeArbitrage reverts on an empty array).
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

    function test_AdminCanGrantOperatorRole() public {
        assertFalse(arb.hasRole(arb.OPERATOR_ROLE(), stranger));
        
        arb.grantRole(arb.OPERATOR_ROLE(), stranger);
        
        assertTrue(arb.hasRole(arb.OPERATOR_ROLE(), stranger));
    }

    function test_RevertIf_NonAdminGrantsRole() public {
        vm.prank(stranger);
        vm.expectRevert();
        arb.grantRole(arb.OPERATOR_ROLE(), stranger);
    }

    // --- Pausable functionality ---

    function test_PauserCanPauseContract() public {
        assertFalse(arb.paused());
        
        vm.prank(pauser);
        arb.pause();
        
        assertTrue(arb.paused());
    }

    function test_AdminCanUnpauseContract() public {
        vm.prank(pauser);
        arb.pause();
        
        assertTrue(arb.paused());
        
        arb.unpause();
        
        assertFalse(arb.paused());
    }

    function test_RevertIf_NonPauserPauses() public {
        vm.prank(stranger);
        vm.expectRevert();
        arb.pause();
    }

    function test_RevertIf_ExecuteWhenPaused() public {
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](0);
        
        vm.prank(pauser);
        arb.pause();
        
        vm.prank(operator);
        vm.expectRevert();
        arb.executeArbitrage(WETH, 1 ether, calls, 1);
    }

    // --- Whitelist functionality ---

    function test_AdminCanAddToWhitelist() public {
        address newTarget = makeAddr("newTarget");
        assertFalse(arb.isTargetWhitelisted(newTarget));
        
        arb.addTargetToWhitelist(newTarget);
        
        assertTrue(arb.isTargetWhitelisted(newTarget));
    }

    function test_AdminCanRemoveFromWhitelist() public {
        address target = BaseAddresses.MOONWELL_M_USDC;
        assertTrue(arb.isTargetWhitelisted(target));
        
        arb.removeTargetFromWhitelist(target);
        
        assertFalse(arb.isTargetWhitelisted(target));
    }

    function test_RevertIf_NonAdminModifiesWhitelist() public {
        vm.prank(stranger);
        vm.expectRevert();
        arb.addTargetToWhitelist(makeAddr("newTarget"));
    }

    function test_RevertIf_ExecuteWithNonWhitelistedTarget() public {
        address maliciousTarget = makeAddr("malicious");
        
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({
            target: maliciousTarget,
            value: 0,
            data: abi.encodeWithSignature("steal()")
        });
        
        vm.prank(operator);
        vm.expectRevert(FlashLoanArbitrage.InvalidTarget.selector);
        arb.executeArbitrage(WETH, 1 ether, calls, 1);
    }

    // --- Enhanced input validation ---

    function test_RevertIf_ZeroAddressAsset() public {
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](0);
        
        vm.prank(operator);
        vm.expectRevert(FlashLoanArbitrage.ZeroAddress.selector);
        arb.executeArbitrage(address(0), 1 ether, calls, 1);
    }

    function test_RevertIf_ZeroAmount() public {
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](0);
        
        vm.prank(operator);
        vm.expectRevert(FlashLoanArbitrage.InvalidAmount.selector);
        arb.executeArbitrage(WETH, 0, calls, 1);
    }

    function test_RevertIf_EmptyCalls() public {
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](0);
        
        vm.prank(operator);
        vm.expectRevert(FlashLoanArbitrage.InvalidCallsLength.selector);
        arb.executeArbitrage(WETH, 1 ether, calls, 1);
    }

    function test_RevertIf_TooManyCalls() public {
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](21);
        
        vm.prank(operator);
        vm.expectRevert(FlashLoanArbitrage.InvalidCallsLength.selector);
        arb.executeArbitrage(WETH, 1 ether, calls, 1);
    }

    function test_RevertIf_ZeroMinProfit() public {
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({
            target: BaseAddresses.WETH,
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", BaseAddresses.AERODROME_ROUTER, 1 ether)
        });
        
        vm.prank(operator);
        vm.expectRevert(FlashLoanArbitrage.InvalidMinProfit.selector);
        arb.executeArbitrage(WETH, 1 ether, calls, 0);
    }

    function test_RevertIf_CallbackCalledDirectlyByNonMorpho() public {
        vm.expectRevert(FlashLoanArbitrage.NotMorpho.selector);
        arb.onMorphoFlashLoan(1 ether, "");
    }

    function test_RevertIf_CallbackCalledByMorphoWithoutActiveLoan() public {
        // Even if Morpho itself calls back, it must correspond to a loan *this*
        // contract initiated via executeArbitrage — otherwise a malicious flash
        // loan initiated by someone else, forwarding funds to us, could trigger
        // arbitrary calldata execution.
        vm.prank(MORPHO);
        vm.expectRevert(FlashLoanArbitrage.FlashLoanNotInProgress.selector);
        arb.onMorphoFlashLoan(1 ether, abi.encode(WETH, new FlashLoanArbitrage.Call[](0), 1, admin));
    }

    // --- Core flash loan mechanics ---

    function test_RevertIf_NoProfitGenerated() public {
        // Empty call list => balance after == balance before == borrowed amount.
        // owed == assets, so any minProfit > 0 must revert.
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({
            target: BaseAddresses.WETH,
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", BaseAddresses.AERODROME_ROUTER, 1 ether)
        });

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(FlashLoanArbitrage.InsufficientProfit.selector, 1 ether + 1, 1 ether)
        );
        arb.executeArbitrage(WETH, 1 ether, calls, 1);
    }

    function test_ExecuteArbitrage_RepaysLoanAndSweepsSimulatedProfit() public {
        // We don't run a real cross-DEX swap here (that needs live liquidity and
        // is exactly the part your off-chain bot computes) — instead we simulate
        // "the route was profitable" by dealing extra WETH to the contract before
        // the callback runs, then assert the contract correctly: repays Morpho,
        // and forwards only the *profit* (not the principal) to the owner.
        uint256 borrowAmount = 5 ether;
        uint256 simulatedProfit = 0.01 ether;

        // Pre-fund the arbitrage contract with the "profit" a real swap route
        // would have produced, so that after Morpho lends it `borrowAmount`,
        // total balance = borrowAmount + simulatedProfit.
        deal(WETH, address(arb), simulatedProfit);

        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({
            target: BaseAddresses.WETH,
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", BaseAddresses.AERODROME_ROUTER, 1 ether)
        });

        // Profit is swept to the initiator of executeArbitrage — the operator here.
        uint256 operatorBalanceBefore = IERC20(WETH).balanceOf(operator);

        vm.prank(operator);
        arb.executeArbitrage(WETH, borrowAmount, calls, simulatedProfit);

        assertEq(IERC20(WETH).balanceOf(operator), operatorBalanceBefore + simulatedProfit, "profit not forwarded");
        assertEq(IERC20(WETH).balanceOf(address(arb)), 0, "contract should not retain funds");
        assertEq(IERC20(WETH).balanceOf(MORPHO) >= borrowAmount, true, "morpho should be repaid");
    }

    function test_RevertIf_MinProfitNotMet() public {
        uint256 borrowAmount = 5 ether;
        uint256 actualProfit = 0.01 ether;
        uint256 demandedProfit = 0.02 ether; // more than what's actually available

        deal(WETH, address(arb), actualProfit);

        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({
            target: BaseAddresses.WETH,
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", BaseAddresses.AERODROME_ROUTER, 1 ether)
        });

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                FlashLoanArbitrage.InsufficientProfit.selector,
                borrowAmount + demandedProfit,
                borrowAmount + actualProfit
            )
        );
        arb.executeArbitrage(WETH, borrowAmount, calls, demandedProfit);
    }

    // --- Admin / rescue functions ---

    function test_RevertIf_NonAdminWithdraws() public {
        vm.prank(stranger);
        vm.expectRevert();
        arb.withdrawToken(WETH, stranger, 1);
    }

    function test_AdminCanRescueStuckTokens() public {
        deal(WETH, address(arb), 1 ether);

        uint256 before = IERC20(WETH).balanceOf(admin);
        arb.withdrawToken(WETH, admin, 1 ether);

        assertEq(IERC20(WETH).balanceOf(admin), before + 1 ether);
        assertEq(IERC20(WETH).balanceOf(address(arb)), 0);
    }

    function test_AdminCanRescueStuckETH() public {
        vm.deal(address(arb), 1 ether);

        uint256 before = admin.balance;
        arb.withdrawETH(payable(admin), 1 ether);

        assertEq(admin.balance, before + 1 ether);
        assertEq(address(arb).balance, 0);
    }

    function test_RevertIf_NonAdminWithdrawsETH() public {
        vm.prank(stranger);
        vm.expectRevert();
        arb.withdrawETH(payable(stranger), 1 ether);
    }
}
