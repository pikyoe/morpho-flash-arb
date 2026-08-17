/** Ethereum address, as a hex string. Not branded — ethers validates format at runtime. */
export type Address = string;

/** Static metadata for one Aave V3 reserve, fetched once at startup (rarely changes). */
export interface ReserveInfo {
  asset: Address;
  symbol: string;
  decimals: number;
  aTokenAddress: Address;
  variableDebtTokenAddress: Address;
}

/** A user's balance in one reserve — either their collateral (aToken) or debt (variableDebtToken). */
export interface PositionEntry extends ReserveInfo {
  amount: bigint;
}

/** A user's full position: every reserve where they have a non-zero collateral or debt balance. */
export interface UserPosition {
  collateral: PositionEntry[];
  debt: PositionEntry[];
}

/** Result of checking one candidate's on-chain health factor via Aave's Pool. */
export interface HealthCheckResult {
  address: Address;
  healthFactor?: bigint;
  collateralUsd?: bigint;
  error?: string;
}

/** A single call in a FlashLoanArbitrage.Call[] route (must match the Solidity struct exactly). */
export interface ArbitrageCall {
  target: Address;
  value: bigint;
  data: string;
}

/** Prices keyed by asset address, in the Aave oracle's base currency units (8 decimals = USD). */
export type PriceMap = Record<Address, bigint>;

/** Config for watch.ts, assembled from environment variables — see watch.ts header comment. */
export interface WatchConfig {
  pollIntervalMs: number;
  candidateRefreshMs: number;
  scanLimit: number;
  minCollateralUsd: number;
  minProfitUsd: number;
  maxGasPriceGwei: number;
  minWalletEthBalance: number;
  maxConsecutiveFailures: number;
  liveExecution: boolean;
}
