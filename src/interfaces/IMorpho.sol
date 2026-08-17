// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interface for Morpho Blue's flash loan entrypoint.
/// @dev Morpho Blue flash loans are fee-free: you only need to repay the
///      exact `assets` amount by the end of the callback. Full interface:
///      https://github.com/morpho-org/morpho-blue/blob/main/src/interfaces/IMorpho.sol
interface IMorpho {
    /// @notice Flash-borrows `assets` of `token` from Morpho Blue.
    /// @dev Morpho will transfer `assets` of `token` to `msg.sender` (this contract),
    ///      then call `onMorphoFlashLoan(assets, data)` on `msg.sender`.
    ///      The callback MUST leave the Morpho contract with at least `assets` of `token`
    ///      by the time it returns (i.e. approve or transfer it back), or the tx reverts.
    function flashLoan(address token, uint256 assets, bytes calldata data) external;
}

/// @notice Callback interface that a Morpho flash loan borrower must implement.
interface IMorphoFlashLoanCallback {
    /// @param assets The amount of the flash-borrowed asset.
    /// @param data Arbitrary data passed through from the `flashLoan` call.
    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external;
}
