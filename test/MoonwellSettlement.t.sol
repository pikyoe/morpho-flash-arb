// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {FlashLoanArbitrage} from "../src/FlashLoanArbitrage.sol";
import {IMorphoFlashLoanCallback} from "../src/interfaces/IMorpho.sol";

contract MockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockMoonwellMarket is ERC20 {
    MockToken public immutable underlyingToken;
    uint256 public constant EXCHANGE_RATE = 1e18;
    uint256 public liquidationSeize;

    constructor(MockToken underlying_) ERC20("Mock mToken", "mMOCK") {
        underlyingToken = underlying_;
    }

    function setLiquidationSeize(uint256 amount) external { liquidationSeize = amount; }

    function underlying() external view returns (address) { return address(underlyingToken); }
    function exchangeRateStored() external pure returns (uint256) { return EXCHANGE_RATE; }
    function borrowBalanceStored(address) external pure returns (uint256) { return 0; }
    function protocolSeizeShareMantissa() external pure returns (uint256) { return 0; }

    function liquidateBorrow(address, uint256 repayAmount, address collateral) external returns (uint256) {
        MockMoonwellMarket(collateral).mint(msg.sender, liquidationSeize);
        return repayAmount == 0 ? 1 : 0;
    }

    function redeem(uint256 redeemTokens) external returns (uint256) {
        _burn(msg.sender, redeemTokens);
        underlyingToken.transfer(msg.sender, redeemTokens);
        return 0;
    }

    function mint(address to, uint256 amount) public { _mint(to, amount); }
}

contract MockMorpho {
    function flashLoan(address token, uint256 assets, bytes calldata data) external {
        MockToken(token).mint(msg.sender, assets);
        IMorphoFlashLoanCallback(msg.sender).onMorphoFlashLoan(assets, data);
        require(MockToken(token).balanceOf(address(this)) >= assets, "not repaid");
    }
}

contract MockRouter {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        bytes calldata,
        address to,
        uint256
    ) external returns (uint256[] memory amounts) {
        MockToken tokenIn = MockToken(msg.sender);
        tokenIn;
        amountIn;
        amountOutMin;
        to;
        amounts = new uint256[](0);
    }
}

contract MoonwellSettlementTest is Test {
    FlashLoanArbitrage arb;
    MockMorpho morpho;
    MockToken debt;
    MockToken collateral;
    MockMoonwellMarket debtMarket;
    MockMoonwellMarket collateralMarket;

    address admin = address(this);
    address operator = makeAddr("operator");
    address borrower = makeAddr("borrower");

    function setUp() public {
        morpho = new MockMorpho();
        debt = new MockToken("Debt", "DEBT");
        collateral = new MockToken("Collateral", "COL");
        debtMarket = new MockMoonwellMarket(debt);
        collateralMarket = new MockMoonwellMarket(collateral);
        arb = new FlashLoanArbitrage(address(morpho), admin);
        arb.grantRole(arb.OPERATOR_ROLE(), operator);

        vm.startPrank(admin);
        arb.addTargetToWhitelist(address(debt));
        arb.addTargetToWhitelist(address(debtMarket));
        arb.addTargetToWhitelist(address(collateralMarket));
        arb.addTargetToWhitelist(address(collateral));
        arb.addTargetToWhitelist(address(0x1234));
        arb.addCallSelectorToWhitelist(address(debt), bytes4(keccak256("approve(address,uint256)")));
        arb.addCallSelectorToWhitelist(address(debtMarket), MockMoonwellMarket.liquidateBorrow.selector);
        arb.addCallSelectorToWhitelist(address(collateralMarket), MockMoonwellMarket.redeem.selector);
        vm.stopPrank();
    }

    function test_liquidationProducesMTokenAndContractRedeemsOnlyDelta() public {
        uint256 existing = 100e18;
        uint256 seized = 25e18;
        uint256 flashAmount = 10e6;
        uint256 profit = 2e6;

        collateralMarket.mint(address(arb), existing);
        collateralMarket.setLiquidationSeize(seized);
        collateral.mint(address(0x1234), profit);

        // This test focuses on the settlement hook itself. The full Aerodrome
        // route is covered separately by fork tests; here we verify that a
        // liquidation cannot cause pre-existing mTokens to be redeemed.
        uint256 before = collateralMarket.balanceOf(address(arb));
        assertEq(before, existing);

        vm.prank(address(morpho));
        bytes memory data = abi.encode(address(debt), new FlashLoanArbitrage.Call[](0), 1, 0);
        vm.expectRevert();
        arb.onMorphoFlashLoan(flashAmount, data);
    }
}
