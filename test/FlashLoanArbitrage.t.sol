// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {FlashLoanArbitrage} from "../src/FlashLoanArbitrage.sol";
import {IMorpho, IMorphoFlashLoanCallback} from "../src/interfaces/IMorpho.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseAddresses} from "../src/BaseAddresses.sol";

contract FlashLoanArbitrageTest is Test {
    FlashLoanArbitrage public arb;
    address admin = address(this);
    address operator = makeAddr("OPERATOR");
    address pauser = makeAddr("PAUSER");
    address stranger = makeAddr("STRANGER");
    address constant MORPHO = BaseAddresses.MORPHO_BLUE;
    address constant WETH = BaseAddresses.WETH;
    address constant USDC = BaseAddresses.USDC;

    function setUp() public {
        vm.prank(admin);
        arb = new FlashLoanArbitrage(MORPHO, admin);
        vm.prank(admin);
        arb.grantRole(arb.OPERATOR_ROLE(), operator);
        vm.prank(admin);
        arb.grantRole(arb.PAUSER_ROLE(), pauser);
    }

    function test_constructor_setsRolesAndMorpho() public view {
        assertTrue(arb.hasRole(arb.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(arb.hasRole(arb.ADMIN_ROLE(), admin));
        assertTrue(arb.hasRole(arb.OPERATOR_ROLE(), operator));
        assertTrue(arb.hasRole(arb.PAUSER_ROLE(), pauser));
        assertEq(address(arb.morpho()), MORPHO);
    }

    function test_constructor_revertsOnZeroMorpho() public {
        vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.ZeroAddress.selector, "morphoAddress"));
        new FlashLoanArbitrage(address(0), admin);
    }

    function test_constructor_revertsOnZeroAdmin() public {
        vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.ZeroAddress.selector, "initialAdmin"));
        new FlashLoanArbitrage(MORPHO, address(0));
    }

    function test_addTargetToWhitelist() public {
        address target = makeAddr("TARGET");
        vm.prank(admin);
        arb.addTargetToWhitelist(target);
        assertTrue(arb.isTargetWhitelisted(target));
    }

    function test_addTargetToWhitelist_revertsForNonAdmin() public {
        address target = makeAddr("TARGET");
        vm.prank(stranger);
        vm.expectRevert();
        arb.addTargetToWhitelist(target);
    }

    function test_removeTargetFromWhitelist() public {
        address target = makeAddr("TARGET");
        vm.startPrank(admin);
        arb.addTargetToWhitelist(target);
        arb.removeTargetFromWhitelist(target);
        vm.stopPrank();
        assertFalse(arb.isTargetWhitelisted(target));
    }

    function test_batchAddTargetsToWhitelist() public {
        address[] memory targets = new address[](3);
        targets[0] = makeAddr("T1");
        targets[1] = makeAddr("T2");
        targets[2] = makeAddr("T3");
        vm.prank(admin);
        arb.batchAddTargetsToWhitelist(targets);
        for (uint256 i = 0; i < targets.length; i++) assertTrue(arb.isTargetWhitelisted(targets[i]));
    }

    function test_batchAddTargetsToWhitelist_skipsZeroAddress() public {
        address[] memory targets = new address[](2);
        targets[0] = address(0);
        targets[1] = makeAddr("VALID");
        vm.prank(admin);
        arb.batchAddTargetsToWhitelist(targets);
        assertFalse(arb.isTargetWhitelisted(address(0)));
        assertTrue(arb.isTargetWhitelisted(makeAddr("VALID")));
    }

    function test_pause_onlyPauser() public {
        vm.prank(pauser);
        arb.pause();
        assertTrue(arb.paused());
    }

    function test_pause_revertsForNonPauser() public {
        vm.prank(stranger);
        vm.expectRevert();
        arb.pause();
    }

    function test_unpause_onlyAdmin() public {
        vm.prank(pauser);
        arb.pause();
        vm.prank(admin);
        arb.unpause();
        assertFalse(arb.paused());
    }

    function test_executeArbitrage_revertsWhenPaused() public {
        vm.prank(pauser);
        arb.pause();
        address target = makeAddr("TARGET");
        vm.prank(admin);
        arb.addTargetToWhitelist(target);
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](0);
        vm.prank(operator);
        vm.expectRevert();
        arb.executeArbitrage(USDC, 1e6, calls, 1);
    }

    function test_executeArbitrage_revertsForZeroAsset() public {
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](0);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.ZeroAddress.selector, "asset"));
        arb.executeArbitrage(address(0), 1e6, calls, 1);
    }

    function test_executeArbitrage_revertsForDustAmount() public {
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](0);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.InvalidAmount.selector, 100));
        arb.executeArbitrage(USDC, 100, calls, 1);
    }

    function test_executeArbitrage_revertsForEmptyCalls() public {
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](0);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.InvalidCallsLength.selector, 0));
        arb.executeArbitrage(USDC, 1e6, calls, 1);
    }

    function test_executeArbitrage_revertsForZeroMinProfit() public {
        address target = makeAddr("TARGET");
        vm.prank(admin);
        arb.addTargetToWhitelist(target);
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({target: target, value: 0, data: ""});
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.InvalidMinProfit.selector, 0));
        arb.executeArbitrage(USDC, 1e6, calls, 0);
    }

    function test_executeArbitrage_revertsForNonWhitelistedTarget() public {
        address unlisted = makeAddr("UNLISTED");
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({target: unlisted, value: 0, data: ""});
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.InvalidTarget.selector, unlisted));
        arb.executeArbitrage(USDC, 1e6, calls, 1);
    }

    function test_executeArbitrage_revertsForNonOperator() public {
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](0);
        vm.prank(stranger);
        vm.expectRevert();
        arb.executeArbitrage(USDC, 1e6, calls, 1);
    }

    function test_executeArbitrage_revertsForTooManyCalls() public {
        address target = makeAddr("TARGET");
        vm.prank(admin);
        arb.addTargetToWhitelist(target);
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](21);
        for (uint256 i = 0; i < 21; i++) calls[i] = FlashLoanArbitrage.Call({target: target, value: 0, data: ""});
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.InvalidCallsLength.selector, 21));
        arb.executeArbitrage(USDC, 1e6, calls, 1);
    }

    function test_withdrawToken_onlyAdmin() public {
        address token = makeAddr("TOKEN");
        address to = makeAddr("TO");
        vm.prank(stranger);
        vm.expectRevert();
        arb.withdrawToken(token, to, 100);
    }

    function test_withdrawETH_onlyAdmin() public {
        address payable to = payable(makeAddr("TO"));
        vm.prank(stranger);
        vm.expectRevert();
        arb.withdrawETH(to, 1 ether);
    }

    function test_receiveETH() public {
        vm.deal(admin, 1 ether);
        vm.prank(admin);
        (bool success,) = address(arb).call{value: 1 ether}("");
        assertTrue(success);
        assertEq(address(arb).balance, 1 ether);
    }
}
// --- Additional tests: DEFAULT_MIN_FLASH_LOAN_SIZE decimal-mismatch coverage ---
// Add these inside the existing FlashLoanArbitrageTest contract. Adjust
// `arb` / `admin` / `operator` / `stranger` to match your actual setUp()
// variable names if they differ.

function test_DefaultMinFlashLoanSize_AcceptsDustAmountForWeth() public {
    // Documents a real gap: the *default* minimum (1e6 raw units) is
    // calibrated for 6-decimal assets like USDC (= 1.0 USDC), but provides
    // essentially no protection for 18-decimal assets like WETH, where
    // 1e6 wei = 0.000000000001 WETH.
    //
    // Proof: this "dust" amount does NOT trigger InvalidAmount — execution
    // proceeds past the amount check and reverts instead on the *next*
    // check (InvalidCallsLength, since we deliberately pass an empty
    // calls array). If the amount check had caught it, we'd see
    // InvalidAmount here instead.
    uint256 dustWeth = 1e6; // 0.000000000001 WETH

    FlashLoanArbitrage.Call[] memory emptyCalls = new FlashLoanArbitrage.Call[](0);

    vm.prank(operator);
    vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.InvalidCallsLength.selector, 0));
    arb.executeArbitrage(BaseAddresses.WETH, dustWeth, emptyCalls, 1);
}

function test_SetMinimumFlashLoanSize_ProtectsWeth() public {
    // Mitigation: admin explicitly configures a WETH-appropriate minimum.
    uint256 sensibleWethMinimum = 0.01 ether;

    vm.prank(admin);
    arb.setMinimumFlashLoanSize(BaseAddresses.WETH, sensibleWethMinimum);

    uint256 tooSmall = 0.001 ether; // below the new minimum, still far above the old default
    FlashLoanArbitrage.Call[] memory emptyCalls = new FlashLoanArbitrage.Call[](0);

    vm.prank(operator);
    vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.InvalidAmount.selector, tooSmall));
    arb.executeArbitrage(BaseAddresses.WETH, tooSmall, emptyCalls, 1);
}

function test_SetMinimumFlashLoanSize_RevertsForNonAdmin() public {
    vm.prank(stranger);
    vm.expectRevert(); // OpenZeppelin AccessControl: unauthorized account
    arb.setMinimumFlashLoanSize(BaseAddresses.WETH, 0.01 ether);
}

function test_SetMinimumFlashLoanSize_RevertsForZeroAmount() public {
    vm.prank(admin);
    vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.InvalidAmount.selector, 0));
    arb.setMinimumFlashLoanSize(BaseAddresses.WETH, 0);
}

function test_SetMinimumFlashLoanSize_RevertsForZeroAddressAsset() public {
    vm.prank(admin);
    vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.ZeroAddress.selector, "asset"));
    arb.setMinimumFlashLoanSize(address(0), 0.01 ether);
}

function test_SetMinimumFlashLoanSize_EmitsEvent() public {
    vm.expectEmit(true, false, false, true, address(arb));
    emit FlashLoanArbitrage.MinimumFlashLoanSizeUpdated(BaseAddresses.WETH, 0.01 ether);

    vm.prank(admin);
    arb.setMinimumFlashLoanSize(BaseAddresses.WETH, 0.01 ether);
}

function test_MinimumFlashLoanSize_DoesNotAffectOtherAssets() public {
    // Setting a minimum for WETH must not accidentally change the
    // (still-default) minimum enforced for a different asset, e.g. USDC.
    vm.prank(admin);
    arb.setMinimumFlashLoanSize(BaseAddresses.WETH, 0.01 ether);

    // 0.5 USDC (6 decimals) — below the DEFAULT_MIN_FLASH_LOAN_SIZE (1e6 = 1.0 USDC),
    // so this must still revert via the untouched default for USDC.
    uint256 belowUsdcDefault = 0.5e6;
    FlashLoanArbitrage.Call[] memory emptyCalls = new FlashLoanArbitrage.Call[](0);

    vm.prank(operator);
    vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.InvalidAmount.selector, belowUsdcDefault));
    arb.executeArbitrage(BaseAddresses.USDC, belowUsdcDefault, emptyCalls, 1);
}
