// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IMorpho, IMorphoFlashLoanCallback} from "./interfaces/IMorpho.sol";

/// @title FlashLoanArbitrage
/// @notice Flash-borrows an asset from Morpho Blue (fee-free flash loans) on Base,
///         executes an arbitrary, off-chain-computed sequence of calls (a DEX leg
///         such as Aerodrome/Uniswap V3, and a lending-protocol leg such as a
///         Moonwell or Aave V3 liquidation) to capture a price/rate spread, repays
///         the loan, and sweeps any profit to the owner.
/// @dev This contract is deliberately generic: it does not hardcode a single DEX or
///      lending protocol. Profitable routes must be found off-chain (see the `bot/`
///      script) because scanning prices on-chain is far too gas-expensive to be
///      profitable itself. The contract's only on-chain responsibilities are:
///        1) verify the caller/flow is legitimate (only Morpho, only mid flash loan),
///        2) execute the exact calls the owner asked for,
///        3) enforce a minimum-profit check before repaying,
///        4) repay the loan and forward profit to the owner.
/// @dev Security enhancements:
///      - Role-based access control (ADMIN, OPERATOR, PAUSER)
///      - Pausable functionality for emergency stops
///      - Target contract whitelisting
///      - Enhanced input validation
contract FlashLoanArbitrage is IMorphoFlashLoanCallback, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Role identifiers for access control
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice A single call to make as part of an arbitrage route
    ///         (e.g. "swap on Aerodrome" or "Moonwell liquidateBorrow").
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    /// @notice The Morpho Blue singleton this contract borrows from.
    IMorpho public immutable morpho;

    /// @dev Set to true only while a flash loan we initiated is in flight,
    ///      so the callback can't be triggered by an unrelated/malicious flash loan.
    bool private flashLoanInProgress;

    /// @notice Whitelisted target contracts for arbitrage calls
    mapping(address => bool) public isTargetWhitelisted;

    /// @notice Maximum number of calls allowed in a single arbitrage
    uint256 public constant MAX_CALLS = 20;

    /// @notice Minimum flash loan amount (to prevent dust attacks)
    uint256 public constant MIN_FLASH_LOAN_SIZE = 1e6; // 1 unit of most tokens

    event ArbitrageExecuted(address indexed asset, uint256 amountBorrowed, uint256 profit);
    event ProfitWithdrawn(address indexed asset, address indexed to, uint256 amount);
    event TargetWhitelisted(address indexed target, bool whitelisted);
    event ContractPaused(address indexed pauser);
    event ContractUnpaused(address indexed admin);

    error NotMorpho();
    error FlashLoanNotInProgress();
    error InsufficientProfit(uint256 required, uint256 actual);
    error CallFailed(uint256 index, bytes returnData);
    error InvalidTarget(address target);
    error InvalidAmount(uint256 amount);
    error InvalidCallsLength(uint256 length);
    error InvalidMinProfit(uint256 minProfit);
    error ZeroAddress(string param);

    constructor(address morphoAddress, address initialAdmin) {
        if (morphoAddress == address(0)) revert ZeroAddress("morphoAddress");
        if (initialAdmin == address(0)) revert ZeroAddress("initialAdmin");
        
        morpho = IMorpho(morphoAddress);
        
        // Setup initial roles
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(ADMIN_ROLE, initialAdmin);
        _grantRole(OPERATOR_ROLE, initialAdmin);
        _grantRole(PAUSER_ROLE, initialAdmin);
    }

    /// @notice Kicks off an arbitrage: flash-borrows `amount` of `asset` from Morpho,
    ///         then executes `calls` (built off-chain), then requires the resulting
    ///         balance of `asset` to cover the loan plus at least `minProfit`.
    /// @param asset The token to flash-borrow (and the token profit is measured in).
    /// @param amount The amount to flash-borrow.
    /// @param calls The sequence of calls to execute inside the callback
    ///        (e.g. approve + swap on a DEX, then interact with a lending protocol).
    /// @param minProfit The minimum acceptable profit in `asset`, after repaying the
    ///        loan. Reverts if not met, so the whole arbitrage (and the flash loan) is
    ///        atomically undone — you never end up "stuck" mid-arbitrage.
    function executeArbitrage(address asset, uint256 amount, Call[] calldata calls, uint256 minProfit)
        external
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
        nonReentrant
    {
        // Input validation
        if (asset == address(0)) revert ZeroAddress("asset");
        if (amount < MIN_FLASH_LOAN_SIZE) revert InvalidAmount(amount);
        if (calls.length == 0 || calls.length > MAX_CALLS) revert InvalidCallsLength(calls.length);
        if (minProfit == 0) revert InvalidMinProfit(minProfit);
        
        // Validate all call targets are whitelisted
        for (uint256 i = 0; i < calls.length; i++) {
            if (!isTargetWhitelisted(calls[i].target)) {
                revert InvalidTarget(calls[i].target);
            }
        }
        
        bytes memory data = abi.encode(asset, calls, minProfit, msg.sender);
        flashLoanInProgress = true;
        morpho.flashLoan(asset, amount, data);
        flashLoanInProgress = false;
    }

    /// @inheritdoc IMorphoFlashLoanCallback
    /// @dev Called by Morpho mid-`flashLoan`. At this point the contract already
    ///      holds `assets` of the flash-borrowed token.
    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external override {
        if (msg.sender != address(morpho)) revert NotMorpho();
        if (!flashLoanInProgress) revert FlashLoanNotInProgress();

        (address asset, Call[] memory calls, uint256 minProfit, address initiator) =
            abi.decode(data, (address, Call[], uint256, address));

        // Execute the off-chain-computed route (DEX swap(s), lending-protocol call(s), etc).
        for (uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory ret) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!success) revert CallFailed(i, ret);
        }

        uint256 balance = IERC20(asset).balanceOf(address(this));
        // Morpho Blue flash loans currently charge zero fee, but we compare against
        // `assets` explicitly (rather than assuming 0 fee) to stay correct even if
        // that ever changes upstream.
        uint256 owed = assets;
        if (balance < owed + minProfit) {
            revert InsufficientProfit(owed + minProfit, balance);
        }

        uint256 profit = balance - owed;

        // Repay the flash loan: Morpho pulls `assets` back via transferFrom-style
        // accounting, so we approve it directly.
        IERC20(asset).forceApprove(address(morpho), owed);

        // Sweep profit straight to whoever initiated this arbitrage.
        if (profit > 0) {
            IERC20(asset).safeTransfer(initiator, profit);
        }

        emit ArbitrageExecuted(asset, assets, profit);
    }

    /// @notice Rescue any tokens that end up stuck in this contract (e.g. dust from a
    ///         partially-filled route, or a token sent here by mistake).
    function withdrawToken(address token, address to, uint256 amount) external onlyRole(ADMIN_ROLE) nonReentrant {
        if (token == address(0)) revert ZeroAddress("token");
        if (to == address(0)) revert ZeroAddress("to");
        IERC20(token).safeTransfer(to, amount);
        emit ProfitWithdrawn(token, to, amount);
    }

    /// @notice Rescue any native ETH stuck in this contract.
    function withdrawETH(address payable to, uint256 amount) external onlyRole(ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress("to");
        (bool success,) = to.call{value: amount}("");
        require(success, "ETH transfer failed");
    }

    // --- Whitelist Management ---

    /// @notice Add a target contract to the whitelist
    function addTargetToWhitelist(address target) external onlyRole(ADMIN_ROLE) {
        if (target == address(0)) revert ZeroAddress("target");
        isTargetWhitelisted[target] = true;
        emit TargetWhitelisted(target, true);
    }

    /// @notice Remove a target contract from the whitelist
    function removeTargetFromWhitelist(address target) external onlyRole(ADMIN_ROLE) {
        isTargetWhitelisted[target] = false;
        emit TargetWhitelisted(target, false);
    }

    /// @notice Batch add targets to whitelist
    function batchAddTargetsToWhitelist(address[] calldata targets) external onlyRole(ADMIN_ROLE) {
        for (uint256 i = 0; i < targets.length; i++) {
            if (targets[i] != address(0)) {
                isTargetWhitelisted[targets[i]] = true;
                emit TargetWhitelisted(targets[i], true);
            }
        }
    }

    // --- Emergency Functions ---

    /// @notice Pause the contract - emergency stop
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
        emit ContractPaused(msg.sender);
    }

    /// @notice Unpause the contract
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
        emit ContractUnpaused(msg.sender);
    }

    /// @dev Allow the contract to receive ETH (e.g. if a route unwraps WETH).
    receive() external payable {}
}
