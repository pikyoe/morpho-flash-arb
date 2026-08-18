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

    // --- Moonwell (Compound V2 fork on Base) ---
    // Sourced from https://docs.moonwell.fi/moonwell/protocol-information/contracts
    // (verified Aug 2026 — re-verify before mainnet deployment).
    address internal constant MOONWELL_COMPTROLLER = 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C;
    address internal constant MOONWELL_CHAINLINK_ORACLE = 0xEC942bE8A8114bFD0396A5052c36027f2cA6a9d0;

    // Moonwell mToken markets on Base (one contract per underlying asset).
    address internal constant MOONWELL_M_USDC = 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22;
    address internal constant MOONWELL_M_WETH = 0x628ff693426583D9a7FB391E54366292F509D457;
    address internal constant MOONWELL_M_CBETH = 0x3bf93770f2d4a794c3d9EBEfBAeBAE2a8f09A5E5;
    address internal constant MOONWELL_M_WSTETH = 0x627Fe393Bc6EdDA28e99AE648fD6fF362514304b;
    address internal constant MOONWELL_M_AERO = 0x73902f619CEB9B31FD8EFecf435CbDf89E369Ba6;
    address internal constant MOONWELL_M_CBBTC = 0xF877ACaFA28c19b96727966690b2f44d35aD5976;

    // OEV wrapper for WETH-collateral liquidations on Base (one wrapper per
    // collateral feed; see https://docs.moonwell.fi/moonwell/developers/protocol/oev/core-markets).
    address internal constant MOONWELL_OEV_WRAPPER_WETH = 0xeb083d234ec636A10325ea42bCbbE09Aa56d1547;

    // --- Common tokens on Base ---
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant CBETH = 0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22;

    // --- Additional Moonwell collateral tokens on Base ---
    address internal constant WSTETH = 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452;
    address internal constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address internal constant AERO = 0x940181a94A35A4569E4529A3CDfB74e38FD98631;

    // --- Aave V3 Oracle (Chainlink-based, prices in USD, 8 decimals) ---
    address internal constant AAVE_V3_ORACLE = 0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156;
}
