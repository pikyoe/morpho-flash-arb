/** Ethereum address, as a hex string. Not branded — ethers validates format at runtime. */
export type Address = string;

/** Static metadata for one Moonwell market (mToken), fetched once at startup (rarely changes). */
export interface MarketInfo {
  /** The mToken market contract (liquidateBorrow / redeem / borrowBalanceStored are called on it). */
  mToken: Address;
  /** The underlying ERC20 the market supplies and borrows. */
  asset: Address;
  /** Underlying token symbol (for logs). */
  symbol: string;
  /** Underlying token decimals. */
  decimals: number;
  /** mToken → underlying exchange rate (18-dec mantissa), from `exchangeRateStored()`. */
  exchangeRate: bigint;
}

/** A user's balance in one market — collateral or debt, denominated in UNDERLYING units. */
export interface PositionEntry extends MarketInfo {
  amount: bigint;
}

/** A user's full position: every scanned market where they have non-zero collateral or debt. */
export interface UserPosition {
  collateral: PositionEntry[];
  debt: PositionEntry[];
}

/** Result of checking one candidate's on-chain health via the Moonwell Comptroller. */
export interface HealthCheckResult {
  address: Address;
  /** Comptroller `shortfall` in USD (18-dec mantissa). `> 0` means the account is liquidatable. */
  shortfall?: bigint;
  /** Remaining borrow capacity in USD (18-dec) when the account is healthy. */
  liquidity?: bigint;
  error?: string;
}

/** A single call in a FlashLoanArbitrage.Call[] route (must match the Solidity struct exactly). */
export interface ArbitrageCall {
  target: Address;
  value: bigint;
  data: string;
}

/** Prices keyed by mToken address, in the Moonwell oracle's USD units (18 decimals). */
export type PriceMap = Record<Address, bigint>;

/** One hop of an Aerodrome swap route. */
export interface AerodromeRoute {
  from: Address;
  to: Address;
  stable: boolean;
  factory: Address;
}

/**
 * A fully-sized, quoted, ready-to-execute liquidation opportunity.
 * All amounts are computed with the *exact* Compound V2-compatible on-chain math
 * (see bot/executor.ts): close factor, liquidation incentive and protocol seize
 * share read from the Comptroller, and the user's real mToken collateral cap.
 */
export interface Opportunity {
  user: Address;
  /** Display-only collateralization ratio (raw collateral USD / debt USD, 18-dec). The real gate is the Comptroller's shortfall. */
  healthFactor: bigint;

  debtAsset: Address;
  debtSymbol: string;
  debtDecimals: number;
  collateralAsset: Address;
  collateralSymbol: string;
  collateralDecimals: number;

  /** The debt market mToken (liquidateBorrow is called on it). */
  mTokenDebt: Address;
  /** The collateral market mToken (seized collateral comes from it). */
  mTokenCollateral: Address;

  /** Debt actually pulled by Moonwell — this is also the Morpho flash-loan amount. */
  debtToCover: bigint;
  /** Gross collateral seized (underlying units, INCLUDING the protocol's share). */
  collateralAmount: bigint;
  /** Protocol's share of the seized collateral (underlying units, goes to Moonwell reserves). */
  protocolFeeAmount: bigint;
  /** Net collateral the contract receives and sells on Aerodrome. */
  swapAmountIn: bigint;

  /** Quoted proceeds from selling swapAmountIn collateral into the debt asset. */
  dexProceeds: bigint;
  /** Min proceeds enforced on-chain (quote minus slippage). */
  amountOutMin: bigint;
  /** minProfit passed to FlashLoanArbitrage.executeArbitrage (debt units, > 0). */
  minProfit: bigint;

  /** Estimated profit = dexProceeds - debtToCover, in debt units and USD. */
  profitDebtUnits: bigint;
  profitUsd: number;

  /** Liquidation incentive in bps INCLUDING the base 10000 (e.g. 11000 = +10%). */
  liquidationBonusRaw: bigint;
  /** Net bonus above 100% in bps (e.g. 1000 = +10%). */
  liquidationBonusNetBps: bigint;
  routes: AerodromeRoute[];
  calls: ArbitrageCall[];
  deadline: number;

  /** The full position + prices used to build this opportunity (for ML / logging). */
  position: UserPosition;
  prices: PriceMap;

  /** False when ARBITRAGE_CONTRACT_ADDRESS is unset and calls use a placeholder recipient. */
  readyToExecute: boolean;
}

/** Result of attempting to execute an opportunity. */
export interface ExecuteResult {
  status: "dry-run" | "submitted" | "confirmed" | "simulation-reverted" | "skipped" | "timeout" | "error";
  txHash?: string;
  message: string;
}

/** Runtime configuration for the liquidation executor, assembled from env vars. */
export interface ExecutorConfig {
  rpcUrl: string;
  chainId: number;
  liveExecution: boolean;
  minProfitUsd: number;
  minCollateralUsd: number;
  maxGasPriceGwei: number;
  minWalletEthBalance: number;
  maxConsecutiveFailures: number;
  slippageBps: number;
  gasLimitMultiplierPct: number;
  txTimeoutMs: number;
  maxTxRetries: number;
  simulateBeforeSend: boolean;
  priorityFeeGwei: number;
  privateRpcUrls: string[];
  bloxrouteAuthHeader: string | undefined;
  /** When true, never broadcast to the public mempool (private endpoints only). */
  privateOnly: boolean;
  arbAddress: string | undefined;
  privateKey: string | undefined;
}
