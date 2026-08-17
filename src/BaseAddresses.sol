// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Known, verified contract addresses on Base mainnet (chain id 8453).
/// @dev Sourced from official docs as of Aug 2026 — always re-verify against
///      https://docs.morpho.org/get-started/resources/addresses/ (Morpho),
///      https://aerodrome.finance/security (Aerodrome) and
///      https://docs.aave.com/developers/deployed-contracts/v3-mainnet (Aave)
///      before mainnet deployment, since protocols occasionally redeploy.
library BaseAddresses {
    // --- Morpho Blue ---
    address internal constant MORPHO_BLUE = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    address internal constant MORPHO_ADAPTIVE_CURVE_IRM = 0x46415998764C29aB2a25CbeA6254146D50D22687;

    // --- Aerodrome (Base's native DEX) ---
    address internal constant AERODROME_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address internal constant AERODROME_POOL_FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;

    // --- Uniswap V3 (also on Base) ---
    address internal constant UNISWAP_V3_SWAP_ROUTER02 = 0x2626664c2603336E57B271c5C0b26F421741e481;

    // --- Aave V3 (also on Base) ---
    address internal constant AAVE_V3_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;

    // --- Common tokens on Base ---
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant CBETH = 0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22;

    // --- Aave V3 Oracle (Chainlink-based, prices in USD, 8 decimals) ---
    address internal constant AAVE_V3_ORACLE = 0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156;
}
