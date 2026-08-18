import type { Address } from "./types.js";

// Known, verified contract addresses on Base mainnet (chain id 8453).
// Keep in sync with src/BaseAddresses.sol.
export const ADDRESSES: Record<string, Address> = {
  MORPHO_BLUE: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  AERODROME_ROUTER: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
  AERODROME_POOL_FACTORY: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
  UNISWAP_V3_SWAP_ROUTER02: "0x2626664c2603336E57B271c5C0b26F421741e481",
  MOONWELL_COMPTROLLER: "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C",
  MOONWELL_CHAINLINK_ORACLE: "0xEC942bE8A8114bFD0396A5052c36027f2cA6a9d0",
  MOONWELL_OEV_WRAPPER_WETH: "0xeb083d234ec636A10325ea42bCbbE09Aa56d1547",
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  CBETH: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
  WSTETH: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
  CBBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  AERO: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
} as const;

// Moonwell mToken markets the bot scans. Verified Aug 2026 against
// https://docs.moonwell.fi/moonwell/protocol-information/contracts.
// `mToken` is the market contract (liquidateBorrow / redeem / borrowBalanceStored
// are called on it); `asset` is its underlying ERC20; `symbol` is for logs.
export const MARKETS: ReadonlyArray<{ mToken: Address; asset: Address; symbol: string }> = [
  {
    mToken: "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    symbol: "USDC",
  },
  {
    mToken: "0x628ff693426583D9a7FB391E54366292F509D457",
    asset: "0x4200000000000000000000000000000000000006",
    symbol: "WETH",
  },
  {
    mToken: "0x3bf93770f2d4a794c3d9EBEfBAeBAE2a8f09A5E5",
    asset: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    symbol: "cbETH",
  },
  {
    mToken: "0x627Fe393Bc6EdDA28e99AE648fD6fF362514304b",
    asset: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
    symbol: "wstETH",
  },
  {
    mToken: "0x73902f619CEB9B31FD8EFecf435CbDf89E369Ba6",
    asset: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    symbol: "AERO",
  },
  {
    mToken: "0xF877ACaFA28c19b96727966690b2f44d35aD5976",
    asset: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    symbol: "cbBTC",
  },
] as const;
