// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FlashLoanArbitrage} from "../src/FlashLoanArbitrage.sol";
import {IMorphoFlashLoanCallback} from "../src/interfaces/IMorpho.sol";
import {IMoonwellMarket} from "../src/interfaces/IMoonwellMarket.sol";

/// @dev Minimal ERC20 for callback-path tests.
contract MockERC20 {
    string public constant symbol = "MOCK";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev Mirrors Morpho Blue flash loan flow: send assets, callback, pull repayment.
contract MockMorpho {
    function flashLoan(address token, uint256 assets, bytes calldata data) external {
        MockERC20(token).transfer(msg.sender, assets);
        IMorphoFlashLoanCallback(msg.sender).onMorphoFlashLoan(assets, data);
        require(MockERC20(token).transferFrom(msg.sender, address(this), assets), "flash loan not repaid");
    }
}

/// @dev Returns configurable Compound-style error codes instead of reverting.
contract MockMToken {
    uint256 public errorCode;

    function setErrorCode(uint256 code) external {
        errorCode = code;
    }

    function liquidateBorrow(address, uint256, address) external view returns (uint256) {
        return errorCode;
    }

    function redeem(uint256) external view returns (uint256) {
        return errorCode;
    }

    function redeemUnderlying(uint256) external view returns (uint256) {
        return errorCode;
    }
}

/// @dev Mints `amount` of `token` to the caller — simulates a profitable route leg.
contract MockProfitSource {
    function skim(address token, uint256 amount) external {
        MockERC20(token).mint(msg.sender, amount);
    }
}

contract FlashLoanCallbackTest is Test {
    FlashLoanArbitrage internal arb;
    MockERC20 internal token;
    MockMorpho internal mockMorpho;
    MockMToken internal mToken;
    MockProfitSource internal profitSource;

    address internal admin = address(this);
    address internal operator = makeAddr("operator");
    address internal treasuryAddr = makeAddr("treasury");

    uint256 internal constant LOAN = 1_000e6;
    uint256 internal constant PROFIT = 50e6;

    function setUp() public {
        token = new MockERC20();
        mockMorpho = new MockMorpho();
        mToken = new MockMToken();
        profitSource = new MockProfitSource();

        arb = new FlashLoanArbitrage(address(mockMorpho), admin);
        arb.grantRole(arb.OPERATOR_ROLE(), operator);
        arb.setTreasury(treasuryAddr);

        arb.addTargetToWhitelist(address(profitSource));
        arb.addCallSelectorToWhitelist(address(profitSource), MockProfitSource.skim.selector);
        arb.addTargetToWhitelist(address(mToken));
        arb.addCallSelectorToWhitelist(address(mToken), IMoonwellMarket.liquidateBorrow.selector);
        arb.addCallSelectorToWhitelist(address(mToken), IMoonwellMarket.redeem.selector);
        arb.addCallSelectorToWhitelist(address(mToken), IMoonwellMarket.redeemUnderlying.selector);

        token.mint(address(mockMorpho), LOAN * 10);
    }

    function test_profitGoesToTreasuryNotOperator() public {
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({
            target: address(profitSource), value: 0, data: abi.encodeCall(MockProfitSource.skim, (address(token), PROFIT))
        });

        vm.prank(operator);
        arb.executeArbitrage(address(token), LOAN, calls, PROFIT);

        assertEq(token.balanceOf(treasuryAddr), PROFIT);
        assertEq(token.balanceOf(operator), 0);
        assertEq(token.balanceOf(address(arb)), 0);
        assertEq(token.balanceOf(address(mockMorpho)), LOAN * 10);
    }

    function test_moonwellErrorCodeReverts() public {
        mToken.setErrorCode(3);
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({
            target: address(mToken),
            value: 0,
            data: abi.encodeCall(IMoonwellMarket.liquidateBorrow, (makeAddr("borrower"), LOAN, address(mToken)))
        });

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.ErrorCodeReturned.selector, 0, 3));
        arb.executeArbitrage(address(token), LOAN, calls, 1);
    }

    function test_redeemErrorCodeReverts() public {
        mToken.setErrorCode(9);
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](1);
        calls[0] = FlashLoanArbitrage.Call({
            target: address(mToken), value: 0, data: abi.encodeCall(IMoonwellMarket.redeemUnderlying, (LOAN))
        });

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(FlashLoanArbitrage.ErrorCodeReturned.selector, 0, 9));
        arb.executeArbitrage(address(token), LOAN, calls, 1);
    }

    function test_successfulMoonwellCallDoesNotRevert() public {
        // errorCode defaults to 0 (success); add a profit leg after it.
        FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](2);
        calls[0] = FlashLoanArbitrage.Call({
            target: address(mToken),
            value: 0,
            data: abi.encodeCall(IMoonwellMarket.liquidateBorrow, (makeAddr("borrower"), LOAN, address(mToken)))
        });
        calls[1] = FlashLoanArbitrage.Call({
            target: address(profitSource), value: 0, data: abi.encodeCall(MockProfitSource.skim, (address(token), PROFIT))
        });

        vm.prank(operator);
        arb.executeArbitrage(address(token), LOAN, calls, PROFIT);
        assertEq(token.balanceOf(treasuryAddr), PROFIT);
    }
}
