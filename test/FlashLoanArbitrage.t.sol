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
        vm.startPrank(admin);
        arb = new FlashLoanArbitrage(MORPHO, admin);
        arb.grantRole(arb.OPERATOR_ROLE(), operator);
        arb.grantRole(arb.PAUSER_ROLE(), pauser);
        vm.stopPrank();
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

    function test_batchAddTargetsToWhitelist_revertsOnZeroAddress() public {
        address[] memory targets = new address[](2);
        targets[0] = address(0);
        targets[1] = makeAddr("VALID");
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.ZeroAddress.selector, "target"));
        arb.batchAddTargetsToWhitelist(targets);
    }

    function test_constructor_setsTreasuryToAdmin() public view {
        assertEq(arb.treasury(), admin);
    }

    function test_setTreasury() public {
        address newTreasury = makeAddr("TREASURY");
        vm.prank(admin);
        vm.expectEmit(true, true, false, false);
        emit FlashLoanArbitrage.TreasuryUpdated(admin, newTreasury);
        arb.setTreasury(newTreasury);
        assertEq(arb.treasury(), newTreasury);
    }

    function test_setTreasury_revertsForNonAdmin() public {
        vm.prank(operator);
        vm.expectRevert();
        arb.setTreasury(makeAddr("TREASURY"));
    }

    function test_setTreasury_revertsOnZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.ZeroAddress.selector, "treasury"));
        arb.setTreasury(address(0));
    }

    function test_executeArbitrage_revertsForNonZeroCallValue() public {
        address target = makeAddr("TARGET");
        vm.startPrank(admin);
        arb.addTargetToWhitelist(target);
        arb.addCallSelectorToWhitelist(target, bytes4(keccak256("someCall()")));
        vm.stopPrank();
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({target: target, value: 1, data: abi.encodeWithSignature("someCall()")});
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.NonZeroCallValue.selector, 1));
        arb.executeArbitrage(USDC, 1e6, calls, 1);
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
