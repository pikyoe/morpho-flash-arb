// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IMorpho, IMorphoFlashLoanCallback} from "./interfaces/IMorpho.sol";
import {IAerodromeRouter} from "./interfaces/IAerodromeRouter.sol";
import {IUniswapV3Router} from "./interfaces/IUniswapV3Router.sol";

contract FlashLoanArbitrage is IMorphoFlashLoanCallback, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    struct Call { address target; uint256 value; bytes data; }

    IMorpho public immutable morpho;
    bool private flashLoanInProgress;
    mapping(address => bool) public isTargetWhitelisted;
    mapping(address => mapping(bytes4 => bool)) public isCallWhitelisted;

    // Minimum is intentionally asset-agnostic because the contract does not store token decimals.
    // Operators must enforce economically meaningful per-asset minimums off-chain.
    uint256 public constant MAX_CALLS = 20;
    uint256 public constant MIN_FLASH_LOAN_SIZE = 1e6;

    event ArbitrageExecuted(address indexed asset, uint256 amountBorrowed, uint256 profit);
    event ProfitWithdrawn(address indexed asset, address indexed to, uint256 amount);
    event ETHWithdrawn(address indexed to, uint256 amount);
    event TargetWhitelisted(address indexed target, bool whitelisted);
    event CallSelectorWhitelisted(address indexed target, bytes4 indexed selector, bool whitelisted);
    event ContractPaused(address indexed pauser);
    event ContractUnpaused(address indexed admin);

    error NotMorpho(); error FlashLoanNotInProgress();
    error InsufficientProfit(uint256 required, uint256 actual); error CallFailed(uint256 index, bytes returnData);
    error InvalidTarget(address target); error InvalidSelector(address target, bytes4 selector);
    error InvalidRecipient(address recipient); error InvalidAmount(uint256 amount);
    error InvalidCallsLength(uint256 length); error InvalidMinProfit(uint256 minProfit);
    error ZeroAddress(string param);

    constructor(address morphoAddress, address initialAdmin) {
        if (morphoAddress == address(0)) revert ZeroAddress("morphoAddress");
        if (initialAdmin == address(0)) revert ZeroAddress("initialAdmin");
        morpho = IMorpho(morphoAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(ADMIN_ROLE, initialAdmin);
        _grantRole(OPERATOR_ROLE, initialAdmin);
        _grantRole(PAUSER_ROLE, initialAdmin);
    }

    function executeArbitrage(address asset, uint256 amount, Call[] calldata calls, uint256 minProfit)
        external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant
    {
        if (asset == address(0)) revert ZeroAddress("asset");
        if (amount < MIN_FLASH_LOAN_SIZE) revert InvalidAmount(amount);
        if (calls.length == 0 || calls.length > MAX_CALLS) revert InvalidCallsLength(calls.length);
        if (minProfit == 0) revert InvalidMinProfit(minProfit);
        for (uint256 i; i < calls.length; i++) _validateCall(calls[i].target, calls[i].data);
        uint256 balanceBefore = IERC20(asset).balanceOf(address(this));
        bytes memory data = abi.encode(asset, calls, minProfit, msg.sender, balanceBefore);
        flashLoanInProgress = true;
        morpho.flashLoan(asset, amount, data);
        flashLoanInProgress = false;
    }

    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external override {
        if (msg.sender != address(morpho)) revert NotMorpho();
        if (!flashLoanInProgress) revert FlashLoanNotInProgress();
        (address asset, Call[] memory calls, uint256 minProfit, address initiator, uint256 balanceBefore) =
            abi.decode(data, (address, Call[], uint256, address, uint256));
        for (uint256 i; i < calls.length; i++) {
            _validateCall(calls[i].target, calls[i].data);
            (bool success, bytes memory ret) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!success) revert CallFailed(i, ret);
        }
        uint256 balanceAfter = IERC20(asset).balanceOf(address(this));
        uint256 requiredBalance = balanceBefore + assets + minProfit;
        if (balanceAfter < requiredBalance) revert InsufficientProfit(requiredBalance, balanceAfter);
        uint256 profit = balanceAfter - balanceBefore - assets;
        _clearRouteApprovals(calls);
        IERC20(asset).forceApprove(address(morpho), assets);
        IERC20(asset).safeTransfer(initiator, profit);
        emit ArbitrageExecuted(asset, assets, profit);
    }

    function withdrawToken(address token, address to, uint256 amount) external onlyRole(ADMIN_ROLE) nonReentrant {
        if (token == address(0)) revert ZeroAddress("token");
        if (to == address(0)) revert ZeroAddress("to");
        IERC20(token).safeTransfer(to, amount); emit ProfitWithdrawn(token, to, amount);
    }
    function withdrawETH(address payable to, uint256 amount) external onlyRole(ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress("to");
        (bool success,) = to.call{value: amount}(""); require(success, "ETH transfer failed");
        emit ETHWithdrawn(to, amount);
    }
    function addTargetToWhitelist(address target) external onlyRole(ADMIN_ROLE) {
        if (target == address(0)) revert ZeroAddress("target"); isTargetWhitelisted[target] = true; emit TargetWhitelisted(target, true);
    }
    function removeTargetFromWhitelist(address target) external onlyRole(ADMIN_ROLE) {
        isTargetWhitelisted[target] = false; emit TargetWhitelisted(target, false);
    }
    function batchAddTargetsToWhitelist(address[] calldata targets) external onlyRole(ADMIN_ROLE) {
        for (uint256 i; i < targets.length; i++) if (targets[i] != address(0)) { isTargetWhitelisted[targets[i]] = true; emit TargetWhitelisted(targets[i], true); }
    }
    function addCallSelectorToWhitelist(address target, bytes4 selector) external onlyRole(ADMIN_ROLE) {
        if (target == address(0)) revert ZeroAddress("target"); if (!isTargetWhitelisted[target]) revert InvalidTarget(target);
        isCallWhitelisted[target][selector] = true; emit CallSelectorWhitelisted(target, selector, true);
    }
    function removeCallSelectorFromWhitelist(address target, bytes4 selector) external onlyRole(ADMIN_ROLE) {
        isCallWhitelisted[target][selector] = false; emit CallSelectorWhitelisted(target, selector, false);
    }
    function batchAddCallSelectorsToWhitelist(address target, bytes4[] calldata selectors) external onlyRole(ADMIN_ROLE) {
        if (target == address(0)) revert ZeroAddress("target"); if (!isTargetWhitelisted[target]) revert InvalidTarget(target);
        for (uint256 i; i < selectors.length; i++) { isCallWhitelisted[target][selectors[i]] = true; emit CallSelectorWhitelisted(target, selectors[i], true); }
    }
    function pause() external onlyRole(PAUSER_ROLE) { _pause(); emit ContractPaused(msg.sender); }
    function unpause() external onlyRole(ADMIN_ROLE) { _unpause(); emit ContractUnpaused(msg.sender); }

    function _validateCall(address target, bytes memory data) internal view {
        bytes4 selector = _selector(data);
        if (!isTargetWhitelisted[target]) revert InvalidTarget(target);
        if (!isCallWhitelisted[target][selector]) revert InvalidSelector(target, selector);

        if (selector == IERC20.approve.selector) {
            if (data.length != 68) revert InvalidSelector(target, selector);
            (address spender,) = abi.decode(_withoutSelector(data), (address, uint256));
            if (!isTargetWhitelisted[spender]) revert InvalidTarget(spender);
            return;
        }
        if (selector == IAerodromeRouter.swapExactTokensForTokens.selector) {
            if (data.length < 164) revert InvalidSelector(target, selector);
            (, , , address recipient,) = abi.decode(_withoutSelector(data), (uint256, uint256, IAerodromeRouter.Route[], address, uint256));
            if (recipient != address(this)) revert InvalidRecipient(recipient);
            return;
        }
        if (selector == IUniswapV3Router.exactInputSingle.selector) {
            if (data.length != 228) revert InvalidSelector(target, selector);
            IUniswapV3Router.ExactInputSingleParams memory params = abi.decode(_withoutSelector(data), (IUniswapV3Router.ExactInputSingleParams));
            if (params.recipient != address(this)) revert InvalidRecipient(params.recipient);
        }
    }

    function _clearRouteApprovals(Call[] memory calls) internal {
        for (uint256 i; i < calls.length; i++) {
            if (_selector(calls[i].data) != IERC20.approve.selector) continue;
            (address spender,) = abi.decode(_withoutSelector(calls[i].data), (address, uint256));
            IERC20(calls[i].target).forceApprove(spender, 0);
        }
    }
    function _withoutSelector(bytes memory data) internal pure returns (bytes memory result) {
        uint256 len = data.length; if (len < 4) return bytes(""); result = new bytes(len - 4);
        assembly { mcopy(add(result, 32), add(data, 36), sub(len, 4)) }
    }
    function _selector(bytes memory data) internal pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0); assembly { selector := mload(add(data, 32)) }
    }
    receive() external payable {}
}
