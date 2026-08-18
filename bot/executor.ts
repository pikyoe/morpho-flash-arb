#!/usr/bin/env node
/**
 * bot/executor.ts — the execution engine shared by the watch bots and the manual
 * CLI (checkPosition.ts). This is the file that actually sends real transactions
 * on Base mainnet, so correctness matters more than brevity.
 *
 * What makes this "mainnet-ready":
 *
 *  1. EXACT Moonwell (Compound V2-compatible) liquidation math. The mToken
 *     silently CAPS `repayAmount` at (closeFactor * userDebt) — 50% on Moonwell
 *     Base. If the bot flashes more debt than Moonwell actually pulls, the
 *     leftover flash-loan debt would eat the profit. We compute the exact
 *     amounts Moonwell will use (close factor, liquidation incentive and
 *     protocol seize share read from the Comptroller, real mToken collateral
 *     balance cap) and flash exactly what Moonwell pulls.
 *
 *  2. Liquidation parameters read on-chain — no more guessing BPS. The
 *     Comptroller exposes closeFactorMantissa() (0.5e18) and liquidationIncentive-
 *     Mantissa() (1.10e18); the protocol's 3% seize share is read per-market from
 *     the COLLATERAL mToken (protocolSeizeShareMantissa() = 0.03e18 — verified on
 *     Base; the Comptroller itself does not expose it). The protocol keeps 3% of
 *     the gross seized collateral, so the liquidator nets ~7% of the 10% bonus.
 *
 *  3. Slippage-protected DEX exit with multi-hop routing (direct pool, then via
 *     WETH or USDC bridge), and an on-chain minProfit guard that can never be 0
 *     (the contract reverts on minProfit == 0).
 *
 *  4. Simulate-before-send: eth_estimateGas + eth_call against pending state,
 *     so a stale position (already liquidated by someone else) is never
 *     broadcast — no wasted gas, no front-run telegraph.
 *
 *  5. Private submission on Base via bloXroute blxr_tx
 *     (api.blxrbdn.com, blockchain_network: "Base-Mainnet" — verified in the
 *     bloXroute docs) when BLOXROUTE_AUTH_HEADER is set, plus generic private
 *     JSON-RPC endpoints via PRIVATE_RPC_URLS. Falls back to the public mempool.
 *
 *  6. Retry + replace-by-fee: re-broadcast the signed tx if not confirmed, then
 *     re-sign with a higher fee (same nonce) so the mempool accepts a
 *     replacement. The whole submission is bounded by TX_TIMEOUT_MS.
 *
 *  Moonwell route built here (standard, non-OEV path):
 *      approve(debtUnderlying -> mTokenDebt, debtToCover)
 *      mTokenDebt.liquidateBorrow(user, debtToCover, mTokenCollateral)
 *      approve(collateralUnderlying -> AerodromeRouter, swapAmountIn)
 *      AerodromeRouter.swapExactTokensForTokens(swapAmountIn, ...)
 *  The seized collateral arrives as the UNDERLYING token directly. For the OEV
 *  path (ChainlinkOEVWrapper) see src/libraries/CallBuilder.sol and README.
 */
import "dotenv/config";
import { ethers } from "ethers";
import { ADDRESSES, MARKETS } from "./addresses.js";
import {
  AERODROME_ROUTER_ABI,
  ERC20_ABI,
  FLASH_LOAN_ARBITRAGE_ABI,
  MOONWELL_COMPTROLLER_ABI,
  MOONWELL_MARKET_ABI,
  MOONWELL_ORACLE_ABI,
} from "./abi.js";
import type {
  Address,
  ArbitrageCall,
  AerodromeRoute,
  ExecuteResult,
  ExecutorConfig,
  HealthCheckResult,
  MarketInfo,
  Opportunity,
  PositionEntry,
  PriceMap,
  UserPosition,
} from "./types.js";

const HF_ONE = 10n ** 18n;
const BPS = 10000n;
/** Moonwell Base: the protocol keeps 3% of gross seized collateral (0.03e18). */
const DEFAULT_PROTOCOL_SEIZE_SHARE = 3n * 10n ** 16n;
/**
 * Read the protocol's share of seized collateral from the collateral mToken
 * (per-market). Falls back to the verified 0.03e18 Base default if a market
 * does not expose the getter.
 */
async function readProtocolSeizeShare(market: ethers.Contract): Promise<bigint> {
  try {
    const share = (await market.protocolSeizeShareMantissa!()) as bigint;
    return share > 0n ? share : DEFAULT_PROTOCOL_SEIZE_SHARE;
  } catch {
    return DEFAULT_PROTOCOL_SEIZE_SHARE;
  }
}
/** Placeholder swap recipient used only for dry-run routes before the contract is deployed. */
const PLACEHOLDER = "0x0000000000000000000000000000000000000001";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ts = (): string => new Date().toISOString();
const log = (...args: unknown[]): void => console.log(`[${ts()}]`, ...args);
const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  return raw !== undefined ? Number(raw) : fallback;
}

function maxBig(...vals: bigint[]): bigint {
  return vals.reduce((acc, v) => (v > acc ? v : acc), 0n);
}

/** USD value (18-dec mantissa) of a position entry, using Moonwell oracle prices. */
function usdValue(e: PositionEntry, prices: PriceMap): bigint {
  const price = prices[e.mToken];
  if (price === undefined) return -1n;
  return (e.amount * price) / 10n ** BigInt(e.decimals);
}
function usdDesc(a: PositionEntry, b: PositionEntry, prices: PriceMap): number {
  const d = usdValue(b, prices) - usdValue(a, prices);
  return d > 0n ? 1 : d < 0n ? -1 : 0;
}

/** POST a JSON-RPC request to an arbitrary endpoint (used for private RPCs). */
async function sendJsonRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "rpc error");
  return json;
}

/**
 * Submit a raw tx to bloXroute's Base private submission endpoint.
 * See https://docs.bloxroute.com/base/submit-transactions/submit-transactions
 */
async function sendBlxrTx(rawTx: string, authHeader: string): Promise<unknown> {
  const res = await fetch("https://api.blxrbdn.com", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "blxr_tx",
      params: { transaction: rawTx.slice(2), blockchain_network: "Base-Mainnet" },
    }),
  });
  if (!res.ok) throw new Error(`bloxroute HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { error?: { message?: string }; result?: unknown };
  if (json.error) throw new Error(json.error.message ?? "blxr_tx error");
  return json.result;
}

async function checkHealthBatch(
  comptroller: ethers.Contract,
  addresses: Address[]
): Promise<HealthCheckResult[]> {
  const CONCURRENCY = 10;
  const results: HealthCheckResult[] = [];
  for (let i = 0; i < addresses.length; i += CONCURRENCY) {
    const batch = addresses.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (addr): Promise<HealthCheckResult> => {
        try {
          const data = await comptroller.getAccountLiquidity!(addr);
          return {
            address: addr,
            shortfall: data.shortfall as bigint,
            liquidity: data.liquidity as bigint,
          };
        } catch (err) {
          return { address: addr, error: msg(err) };
        }
      })
    );
    results.push(...batchResults);
  }
  return results;
}

export function loadConfig(): ExecutorConfig {
  const liveExecution = process.env.LIVE_EXECUTION === "true";
  const privateKey = process.env.PRIVATE_KEY;
  const arbAddress = process.env.ARBITRAGE_CONTRACT_ADDRESS;
  if (liveExecution && (!privateKey || !arbAddress)) {
    throw new Error("LIVE_EXECUTION=true requires PRIVATE_KEY and ARBITRAGE_CONTRACT_ADDRESS in .env");
  }
  const privateRpcUrls = (process.env.PRIVATE_RPC_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return {
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    chainId: 8453,
    liveExecution,
    minProfitUsd: envNumber("MIN_PROFIT_USD", 1),
    minCollateralUsd: envNumber("MIN_COLLATERAL_USD", 100),
    maxGasPriceGwei: envNumber("MAX_GAS_PRICE_GWEI", 5),
    minWalletEthBalance: envNumber("MIN_WALLET_ETH_BALANCE", 0.005),
    maxConsecutiveFailures: envNumber("MAX_CONSECUTIVE_FAILURES", 3),
    slippageBps: envNumber("SLIPPAGE_BPS", 100),
    gasLimitMultiplierPct: envNumber("GAS_LIMIT_MULTIPLIER_PCT", 130),
    txTimeoutMs: envNumber("TX_TIMEOUT_MS", 90000),
    maxTxRetries: envNumber("MAX_TX_RETRIES", 2),
    simulateBeforeSend: process.env.SIMULATE_BEFORE_SEND !== "false",
    priorityFeeGwei: envNumber("PRIORITY_FEE_GWEI", 0.01),
    privateRpcUrls,
    bloxrouteAuthHeader: process.env.BLOXROUTE_AUTH_HEADER,
    arbAddress,
    privateKey,
  };
}

/** One-line human summary of an opportunity (for logs / preview). */
export function describeOpportunity(opp: Opportunity): string {
  return (
    `liquidate ${ethers.formatUnits(opp.debtToCover, opp.debtDecimals)} ${opp.debtSymbol} debt ` +
    `(HF ${ethers.formatUnits(opp.healthFactor, 18)}) -> seize ~` +
    `${ethers.formatUnits(opp.collateralAmount, opp.collateralDecimals)} ${opp.collateralSymbol} ` +
    `-> sell for ~${ethers.formatUnits(opp.dexProceeds, opp.debtDecimals)} ${opp.debtSymbol} ` +
    `=> est. profit $${opp.profitUsd.toFixed(2)}`
  );
}

export class LiquidationExecutor {
  readonly config: ExecutorConfig;
  readonly provider: ethers.JsonRpcProvider;
  readonly comptroller: ethers.Contract;
  readonly oracle: ethers.Contract;
  readonly router: ethers.Contract;
  /** One contract per scanned Moonwell market (mToken) — also used for event discovery. */
  readonly markets: ethers.Contract[] = [];
  marketCache: MarketInfo[] = [];

  /** Governance params, cached at startup (change rarely). */
  closeFactor = 5n * 10n ** 17n; // 0.5e18
  liquidationIncentive = 11n * 10n ** 17n; // 1.10e18

  /** Circuit breaker: flips after maxConsecutiveFailures live failures. */
  paused = false;
  consecutiveFailures = 0;

  private wallet: ethers.Wallet | null;
  private readonly arbInterface: ethers.Interface;

  constructor(config: ExecutorConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId, {
      staticNetwork: true,
      batchMaxCount: 1,
    });
    this.comptroller = new ethers.Contract(ADDRESSES.MOONWELL_COMPTROLLER!, MOONWELL_COMPTROLLER_ABI, this.provider);
    this.oracle = new ethers.Contract(ADDRESSES.MOONWELL_CHAINLINK_ORACLE!, MOONWELL_ORACLE_ABI, this.provider);
    this.router = new ethers.Contract(ADDRESSES.AERODROME_ROUTER!, AERODROME_ROUTER_ABI, this.provider);
    this.arbInterface = new ethers.Interface(FLASH_LOAN_ARBITRAGE_ABI);
    this.wallet = config.liveExecution && config.privateKey ? new ethers.Wallet(config.privateKey, this.provider) : null;
  }

  get walletAddress(): string | null {
    return this.wallet?.address ?? null;
  }

  // --- Static data ----------------------------------------------------------

  /** Loads market metadata (underlying, decimals, exchange rate) + liquidation params. */
  async loadMarkets(): Promise<void> {
    const CONCURRENCY = 8;
    const out: MarketInfo[] = [];
    for (let i = 0; i < MARKETS.length; i += CONCURRENCY) {
      const batch = MARKETS.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (m): Promise<MarketInfo> => {
          const market = new ethers.Contract(m.mToken, MOONWELL_MARKET_ABI, this.provider);
          const underlying = (await market.underlying!()) as Address;
          const exchangeRate = (await market.exchangeRateStored!()) as bigint;
          const token = new ethers.Contract(underlying, ERC20_ABI, this.provider);
          const [symbol, decimals] = (await Promise.all([token.symbol!(), token.decimals!()])) as [string, number];
          return { mToken: m.mToken, asset: underlying, symbol, decimals: Number(decimals), exchangeRate };
        })
      );
      out.push(...results);
    }
    this.marketCache = out;

    // mToken contracts for balance/event reads.
    this.markets.length = 0;
    for (const m of this.marketCache) {
      this.markets.push(new ethers.Contract(m.mToken, MOONWELL_MARKET_ABI, this.provider));
    }

    // Liquidation parameters — read once, re-checked on each deploy.
    try {
      const [cf, inc] = (await Promise.all([
        this.comptroller.closeFactorMantissa!(),
        this.comptroller.liquidationIncentiveMantissa!(),
      ])) as [bigint, bigint];
      this.closeFactor = cf;
      this.liquidationIncentive = inc;
    } catch (err) {
      log(`[warn] could not read Comptroller params (${msg(err)}) — using defaults`);
    }
  }

  // --- Reads ----------------------------------------------------------------

  /** Collateral (underlying = mToken balance × exchange rate) and debt per market. */
  async getPosition(user: Address): Promise<UserPosition | null> {
    const collateral: PositionEntry[] = [];
    const debt: PositionEntry[] = [];
    const CONCURRENCY = 8;
    for (let i = 0; i < this.marketCache.length; i += CONCURRENCY) {
      const batch = this.marketCache.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (r) => {
          const market = new ethers.Contract(r.mToken, MOONWELL_MARKET_ABI, this.provider);
          const [mTokenBal, borrowBal] = (await Promise.all([
            market.balanceOf!(user),
            market.borrowBalanceStored!(user),
          ])) as [bigint, bigint];
          // mTokens → underlying: underlying = mTokens * exchangeRate / 1e18.
          const collateralUnderlying = (mTokenBal * r.exchangeRate) / 10n ** 18n;
          return { r, collateralUnderlying, borrowBal };
        })
      );
      for (const { r, collateralUnderlying, borrowBal } of results) {
        if (collateralUnderlying > 0n) collateral.push({ ...r, amount: collateralUnderlying });
        if (borrowBal > 0n) debt.push({ ...r, amount: borrowBal });
      }
    }
    if (collateral.length === 0 || debt.length === 0) return null;
    return { collateral, debt };
  }

  /** Comptroller account health: (error, liquidity, shortfall). shortfall > 0 ⇒ liquidatable. */
  async accountLiquidity(user: Address): Promise<{ error: bigint; liquidity: bigint; shortfall: bigint }> {
    const data = await this.comptroller.getAccountLiquidity!(user);
    return { error: data.error as bigint, liquidity: data.liquidity as bigint, shortfall: data.shortfall as bigint };
  }

  /** Display-only collateralization ratio (raw collateral USD / debt USD, 18-dec). */
  async healthFactor(user: Address): Promise<bigint | null> {
    try {
      const position = await this.getPosition(user);
      if (!position) return null;
      const prices = await this.getPrices([...position.collateral, ...position.debt]);
      const collateralUsd = position.collateral.reduce((acc, c) => acc + maxBig(usdValue(c, prices), 0n), 0n);
      const debtUsd = position.debt.reduce((acc, d) => acc + maxBig(usdValue(d, prices), 0n), 0n);
      if (debtUsd <= 0n) return HF_ONE;
      return (collateralUsd * HF_ONE) / debtUsd;
    } catch (err) {
      log(`healthFactor(${user}) failed: ${msg(err)}`);
      return null;
    }
  }

  async getPrices(entries: PositionEntry[]): Promise<PriceMap> {
    const prices: PriceMap = {};
    await Promise.all(
      entries.map(async (e) => {
        prices[e.mToken] = (await this.oracle.getUnderlyingPrice!(e.mToken)) as bigint;
      })
    );
    return prices;
  }

  /** Check a batch of candidates and return only currently-liquidatable positions (shortfall > 0), sorted by shortfall desc. */
  async findLiquidatable(candidates: Address[]): Promise<HealthCheckResult[]> {
    const minShortfallWei = BigInt(Math.floor(this.config.minCollateralUsd * 1e18));
    const results = await checkHealthBatch(this.comptroller, candidates);
    return results
      .filter((r): r is HealthCheckResult & { shortfall: bigint } =>
        r.error === undefined && r.shortfall !== undefined
      )
      .filter((r) => r.shortfall > 0n)
      .filter((r) => r.shortfall >= minShortfallWei)
      .sort((a, b) => (a.shortfall > b.shortfall ? -1 : 1));
  }

  // --- Opportunity sizing ---------------------------------------------------

  /**
   * Find the best executable (debt, collateral) pair for a liquidatable user.
   * Returns null when nothing is executable (no route, or below MIN_PROFIT_USD).
   */
  async evaluate(user: Address): Promise<Opportunity | null> {
    const position = await this.getPosition(user);
    if (!position) return null;

    const { error, shortfall } = await this.accountLiquidity(user);
    if (error !== 0n || shortfall <= 0n) return null;

    const prices = await this.getPrices([...position.collateral, ...position.debt]);
    const healthFactor = await this.healthFactor(user);
    if (healthFactor === null) return null;

    const collateral = position.collateral
      .filter((c) => prices[c.mToken] !== undefined)
      .sort((a, b) => usdDesc(a, b, prices));
    const debt = position.debt
      .filter((d) => prices[d.mToken] !== undefined)
      .sort((a, b) => usdDesc(a, b, prices));

    let best: Opportunity | null = null;
    for (const d of debt) {
      for (const c of collateral) {
        if (c.asset.toLowerCase() === d.asset.toLowerCase()) continue;
        const opp = await this.evaluatePair(user, healthFactor, c, d, prices);
        if (opp !== null && (best === null || opp.profitUsd > best.profitUsd)) {
          opp.position = position;
          best = opp;
        }
      }
    }
    return best;
  }

  /**
   * Size one (debt, collateral) pair using the exact Moonwell on-chain math:
   *   grossSeizeTokens = debtToCover * debtPrice * incentive
   *                    / (collateralPrice * exchangeRateCollateral)
   * capped by the borrower's real mToken collateral balance (Compound reverts
   * with LIQUIDATE_SEIZE_TOO_MUCH otherwise — backing out the debt to match),
   * then the protocol's seize share is skimmed and mTokens are converted back
   * to underlying. `opts.debtToCover` (raw debt units) optionally overrides the
   * default of "the maximum the close factor allows".
   */
  async evaluatePair(
    user: Address,
    healthFactor: bigint,
    collateral: PositionEntry,
    debt: PositionEntry,
    prices: PriceMap,
    opts?: { debtToCover?: bigint }
  ): Promise<Opportunity | null> {
    const debtPrice = prices[debt.mToken];
    const collateralPrice = prices[collateral.mToken];
    if (debtPrice === undefined || collateralPrice === undefined || debtPrice === 0n || collateralPrice === 0n) return null;
    if (debt.amount <= 0n || collateral.amount <= 0n) return null;
    if (collateral.exchangeRate <= 0n) return null;
    if (this.liquidationIncentive < HF_ONE) return null; // incentive must be >= 100%

    // Moonwell silently caps repayAmount at closeFactor * userDebt — cap BEFORE
    // flashing, or the leftover flash-loan debt turns profit into loss.
    const maxLiquidatableDebt = (debt.amount * this.closeFactor) / HF_ONE;
    if (maxLiquidatableDebt < 1n) return null;

    let debtToCover = maxLiquidatableDebt;
    if (opts?.debtToCover !== undefined) {
      const desired = opts.debtToCover;
      debtToCover = desired < maxLiquidatableDebt ? desired : maxLiquidatableDebt;
    }
    if (debtToCover < 1n) return null;

    const debtUnit = 10n ** BigInt(debt.decimals);
    const exchangeRate = collateral.exchangeRate;

    // Gross seized collateral in mToken units (mirrors
    // Comptroller.liquidateCalculateSeizeTokens):
    //   seizeTokens = repayAmount * priceBorrowed * incentive
    //               / (priceCollateral * exchangeRate)
    let grossSeizeTokens = (debtToCover * debtPrice * this.liquidationIncentive) / (collateralPrice * exchangeRate);
    if (grossSeizeTokens < 1n) return null;

    // The borrower's real mToken collateral balance caps the liquidation.
    // If we'd seize more than they hold, shrink the flash amount so the seized
    // mTokens match exactly (avoids the on-chain LIQUIDATE_SEIZE_TOO_MUCH revert).
    const market = new ethers.Contract(collateral.mToken, MOONWELL_MARKET_ABI, this.provider);
    const userMTokens = (await market.balanceOf!(user)) as bigint;
    if (grossSeizeTokens > userMTokens) {
      grossSeizeTokens = userMTokens;
      const debtPulled = (grossSeizeTokens * collateralPrice * exchangeRate) / (debtPrice * this.liquidationIncentive);
      if (debtPulled < 1n) return null;
      debtToCover = debtPulled;
    }

    // Protocol keeps `protocolSeizeShare` of the gross seized mTokens; the
    // liquidator sells the rest on the DEX. The share is per-market, read from
    // the COLLATERAL mToken (the Comptroller does not expose it on Base).
    const protocolSeizeShare = await readProtocolSeizeShare(market);
    const protocolSeizeTokens = (grossSeizeTokens * protocolSeizeShare) / HF_ONE;
    const liquidatorSeizeTokens = grossSeizeTokens - protocolSeizeTokens;

    const collateralAmount = (grossSeizeTokens * exchangeRate) / HF_ONE; // gross underlying seized
    const protocolFeeAmount = (protocolSeizeTokens * exchangeRate) / HF_ONE; // protocol share, underlying units
    const swapAmountIn = (liquidatorSeizeTokens * exchangeRate) / HF_ONE; // net underlying to sell
    if (swapAmountIn < 1n) return null;

    // Quote the DEX exit: direct pool first, then via WETH/USDC bridge.
    const { routes, amountOut } = await this.quoteRoutes(collateral.asset, debt.asset, swapAmountIn);
    if (routes.length === 0 || amountOut < debtToCover) return null;

    const amountOutMin = (amountOut * (BPS - BigInt(this.config.slippageBps))) / BPS;
    if (amountOutMin < debtToCover) return null;

    const profitDebtUnits = amountOut - debtToCover;
    if (profitDebtUnits <= 0n) return null;

    // USD: Moonwell oracle prices are 18-dec mantissas.
    const profitUsd = Number(ethers.formatUnits((profitDebtUnits * debtPrice) / debtUnit, 18));
    if (profitUsd < this.config.minProfitUsd) return null;

    // On-chain guard: minProfit must be > 0 (contract reverts on 0) and must be
    // at least the configured USD floor AND the post-slippage floor.
    const cfgMinProfitUnits = (BigInt(Math.floor(this.config.minProfitUsd * 1e18)) * debtUnit) / debtPrice;
    if (amountOutMin - debtToCover < cfgMinProfitUnits) return null;
    const minProfit = maxBig(amountOutMin - debtToCover, cfgMinProfitUnits, 1n);

    // Incentive mantissa (1.10e18) → bps including the base 10000 (11000).
    const liquidationBonusRaw = this.liquidationIncentive / 10n ** 14n;
    if (liquidationBonusRaw < BPS) return null;

    const deadline = Math.floor(Date.now() / 1000) + 300;
    const calls = this.buildCalls(user, collateral, debt, debtToCover, swapAmountIn, amountOutMin, routes, deadline);

    return {
      user,
      healthFactor,
      debtAsset: debt.asset,
      debtSymbol: debt.symbol,
      debtDecimals: debt.decimals,
      collateralAsset: collateral.asset,
      collateralSymbol: collateral.symbol,
      collateralDecimals: collateral.decimals,
      mTokenDebt: debt.mToken,
      mTokenCollateral: collateral.mToken,
      debtToCover,
      collateralAmount,
      protocolFeeAmount,
      swapAmountIn,
      dexProceeds: amountOut,
      amountOutMin,
      minProfit,
      profitDebtUnits,
      profitUsd,
      liquidationBonusRaw,
      liquidationBonusNetBps: liquidationBonusRaw - BPS,
      routes,
      calls,
      deadline,
      position: { collateral: [collateral], debt: [debt] },
      prices,
      readyToExecute: this.config.arbAddress !== undefined,
    };
  }

  /** Best Aerodrome route for selling `amountIn` of `from` into `to`. */
  async quoteRoutes(
    from: Address,
    to: Address,
    amountIn: bigint
  ): Promise<{ routes: AerodromeRoute[]; amountOut: bigint }> {
    const factory = ADDRESSES.AERODROME_POOL_FACTORY!;
    const candidates: AerodromeRoute[][] = [];
    // Direct pool (volatile first, then stable).
    for (const stable of [false, true]) {
      candidates.push([{ from, to, stable, factory }]);
    }
    // Two-hop via a bridge asset (WETH or USDC), trying volatile/stable combos.
    for (const bridge of [ADDRESSES.WETH!, ADDRESSES.USDC!]) {
      if (bridge.toLowerCase() === from.toLowerCase() || bridge.toLowerCase() === to.toLowerCase()) continue;
      for (const s1 of [false, true]) {
        for (const s2 of [false, true]) {
          candidates.push([
            { from, to: bridge, stable: s1, factory },
            { from: bridge, to, stable: s2, factory },
          ]);
        }
      }
    }

    let bestRoutes: AerodromeRoute[] = [];
    let bestOut = 0n;
    for (const routes of candidates) {
      try {
        const amounts = (await this.router.getAmountsOut!(amountIn, routes)) as bigint[];
        const out = amounts[amounts.length - 1];
        if (out !== undefined && out > bestOut) {
          bestOut = out;
          bestRoutes = routes;
        }
      } catch {
        // No pool for this route — try the next candidate.
      }
    }
    return { routes: bestRoutes, amountOut: bestOut };
  }

  /** The calls inside the flash-loan callback: approve debt, liquidate, approve collateral, swap. */
  private buildCalls(
    user: Address,
    collateral: PositionEntry,
    debt: PositionEntry,
    debtToCover: bigint,
    amountIn: bigint,
    amountOutMin: bigint,
    routes: AerodromeRoute[],
    deadline: number
  ): ArbitrageCall[] {
    const recipient = this.config.arbAddress ?? PLACEHOLDER;
    if (this.config.arbAddress === undefined) {
      log("[warn] ARBITRAGE_CONTRACT_ADDRESS not set — built route uses a placeholder recipient (dry-run only)");
    }
    const marketIface = new ethers.Interface(MOONWELL_MARKET_ABI);
    const erc20Iface = new ethers.Interface(ERC20_ABI);
    const routerIface = new ethers.Interface(AERODROME_ROUTER_ABI);
    return [
      // 1. Let the debt mToken pull `debtToCover` of the debt underlying.
      {
        target: debt.asset,
        value: 0n,
        data: erc20Iface.encodeFunctionData("approve", [debt.mToken, debtToCover]),
      },
      // 2. Liquidate: repay the debt, seize collateral (arrives as UNDERLYING).
      {
        target: debt.mToken,
        value: 0n,
        data: marketIface.encodeFunctionData("liquidateBorrow", [user, debtToCover, collateral.mToken]),
      },
      // 3. Let the Aerodrome router sell the seized collateral.
      {
        target: collateral.asset,
        value: 0n,
        data: erc20Iface.encodeFunctionData("approve", [ADDRESSES.AERODROME_ROUTER, amountIn]),
      },
      // 4. Swap collateral → debt asset.
      {
        target: ADDRESSES.AERODROME_ROUTER!,
        value: 0n,
        data: routerIface.encodeFunctionData("swapExactTokensForTokens", [
          amountIn,
          amountOutMin,
          routes,
          recipient,
          deadline,
        ]),
      },
    ];
  }

  // --- Execution ------------------------------------------------------------

  /**
   * Execute an opportunity. In dry-run mode this only logs. In live mode it:
   * checks circuit breaker/gas/ETH floor, estimates gas, simulates against
   * pending state, signs, broadcasts (private then public), and waits with
   * resend + replace-by-fee until TX_TIMEOUT_MS.
   */
  async execute(opp: Opportunity, opts?: { priorityFeeGwei?: number }): Promise<ExecuteResult> {
    if (!this.config.liveExecution) {
      log(`[dry-run] WOULD EXECUTE: ${describeOpportunity(opp)}`);
      return { status: "dry-run", message: "LIVE_EXECUTION not enabled — dry run" };
    }
    if (this.paused) {
      return { status: "skipped", message: "circuit breaker is paused" };
    }
    const wallet = this.wallet;
    if (!wallet || !this.config.arbAddress) {
      return { status: "error", message: "PRIVATE_KEY and ARBITRAGE_CONTRACT_ADDRESS are required for live execution" };
    }
    if (!opp.readyToExecute) {
      return { status: "error", message: "ARBITRAGE_CONTRACT_ADDRESS not set — cannot build a real route" };
    }

    const feeData = await this.provider.getFeeData();
    const gasPriceGwei = Number(ethers.formatUnits(feeData.gasPrice ?? 0n, "gwei"));
    if (gasPriceGwei > this.config.maxGasPriceGwei) {
      return { status: "skipped", message: `gas ${gasPriceGwei.toFixed(3)} gwei exceeds MAX_GAS_PRICE_GWEI cap` };
    }

    const balance = await this.provider.getBalance(wallet.address);
    if (Number(ethers.formatEther(balance)) < this.config.minWalletEthBalance) {
      this.paused = true;
      return { status: "skipped", message: `wallet ETH below ${this.config.minWalletEthBalance} floor — pausing` };
    }

    const data = this.arbInterface.encodeFunctionData("executeArbitrage", [
      opp.debtAsset,
      opp.debtToCover,
      opp.calls,
      opp.minProfit,
    ]);
    const txReqBase = { from: wallet.address, to: this.config.arbAddress, data };

    // Estimate gas and simulate the full flash-loan tx against pending state.
    let gasLimit: bigint;
    try {
      const estimate = await this.provider.estimateGas(txReqBase);
      gasLimit = (estimate * BigInt(this.config.gasLimitMultiplierPct)) / 100n;
    } catch (err) {
      return this.fail(`gas estimation failed (position likely already liquidated): ${msg(err)}`);
    }
    if (this.config.simulateBeforeSend) {
      try {
        await this.provider.call({ ...txReqBase, blockTag: "pending" });
      } catch (err) {
        return this.fail(`simulation reverted (position likely already liquidated): ${msg(err)}`);
      }
    }

    let maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
    let maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n;
    if (maxPriorityFeePerGas === 0n) {
      maxPriorityFeePerGas = ethers.parseUnits(String(opts?.priorityFeeGwei ?? this.config.priorityFeeGwei), "gwei");
    }
    const cap = ethers.parseUnits(String(this.config.maxGasPriceGwei), "gwei");
    if (maxFeePerGas > cap) maxFeePerGas = cap;
    if (maxPriorityFeePerGas > cap) maxPriorityFeePerGas = cap;
    if (maxFeePerGas < maxPriorityFeePerGas + 1n) maxFeePerGas = maxPriorityFeePerGas + 1n;

    const nonce = await wallet.getNonce("pending");
    log(
      `[live] submitting executeArbitrage nonce=${nonce} gasLimit=${gasLimit} ` +
        `maxFee=${ethers.formatUnits(maxFeePerGas, "gwei")} gwei (${gasPriceGwei.toFixed(4)} gwei network)`
    );

    const txRequest = {
      to: this.config.arbAddress,
      data,
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      nonce,
      chainId: this.config.chainId,
      type: 2 as const,
    };
    const rawTx = await wallet.signTransaction(txRequest);
    const hash = ethers.keccak256(rawTx);
    log(`[live] signed tx ${hash}`);
    return this.submitAndWait(wallet, rawTx, hash, nonce, maxFeePerGas, maxPriorityFeePerGas, txRequest);
  }

  private async submitAndWait(
    wallet: ethers.Wallet,
    rawTx: string,
    hash: string,
    nonce: number,
    maxFeePerGas: bigint,
    maxPriorityFeePerGas: bigint,
    baseReq: Parameters<ethers.Wallet["signTransaction"]>[0]
  ): Promise<ExecuteResult> {
    const deadline = Date.now() + this.config.txTimeoutMs;
    const sliceMs = Math.max(5000, Math.floor(this.config.txTimeoutMs / (this.config.maxTxRetries + 2)));
    let resends = 0;
    let bumped = false;

    await this.broadcast(rawTx);
    while (Date.now() < deadline) {
      const receipt = await this.waitForReceipt(hash, Math.min(sliceMs, deadline - Date.now()));
      if (receipt !== null) {
        if (receipt.status === 1) {
          this.consecutiveFailures = 0;
          log(`[live] CONFIRMED in block ${receipt.blockNumber} (${hash})`);
          return { status: "confirmed", txHash: hash, message: `confirmed in block ${receipt.blockNumber}` };
        }
        return this.fail(`tx ${hash} confirmed but REVERTED on-chain (nonce ${nonce})`);
      }
      if (Date.now() >= deadline) break;
      if (!bumped && resends >= this.config.maxTxRetries) {
        // Replace-by-fee: re-sign with a higher fee (same nonce) so nodes accept it.
        const bumpPct = 130n;
        let newMaxFee = (maxFeePerGas * bumpPct) / 100n;
        let newPriorityFee = (maxPriorityFeePerGas * bumpPct) / 100n;
        const cap = ethers.parseUnits(String(this.config.maxGasPriceGwei), "gwei");
        if (newMaxFee > cap) newMaxFee = cap;
        if (newPriorityFee > cap) newPriorityFee = cap;
        if (newMaxFee < newPriorityFee + 1n) newMaxFee = newPriorityFee + 1n;
        const bumpedReq = { ...baseReq, maxFeePerGas: newMaxFee, maxPriorityFeePerGas: newPriorityFee };
        const bumpedRaw = await wallet.signTransaction(bumpedReq);
        const bumpedHash = ethers.keccak256(bumpedRaw);
        log(`[live] RBF bump (nonce ${nonce}): maxFee ${ethers.formatUnits(newMaxFee, "gwei")} gwei, tx ${bumpedHash}`);
        await this.broadcast(bumpedRaw);
        bumped = true;
      } else {
        // Re-send the original — it may have been dropped from the mempool.
        await this.broadcast(rawTx);
        resends++;
      }
    }
    log(`[live] tx ${hash} not confirmed within ${this.config.txTimeoutMs}ms (nonce ${nonce}) — next cycle will re-check`);
    return { status: "timeout", txHash: hash, message: `not confirmed within ${this.config.txTimeoutMs}ms` };
  }

  /** Send a signed tx to every configured endpoint (private first, public last). */
  private async broadcast(rawTx: string): Promise<void> {
    const targets: Array<{ label: string; send: () => Promise<unknown> }> = [];
    for (const url of this.config.privateRpcUrls) {
      targets.push({ label: `private:${url}`, send: () => sendJsonRpc(url, "eth_sendRawTransaction", [rawTx]) });
    }
    if (this.config.bloxrouteAuthHeader) {
      targets.push({ label: "bloxroute", send: () => sendBlxrTx(rawTx, this.config.bloxrouteAuthHeader!) });
    }
    targets.push({ label: "public", send: () => this.provider.broadcastTransaction(rawTx) });

    for (const t of targets) {
      try {
        await t.send();
      } catch (err) {
        const m = msg(err);
        if (m.toLowerCase().includes("already known")) continue; // already in a mempool — fine
        log(`[broadcast:${t.label}] ${m}`);
      }
    }
  }

  private async waitForReceipt(hash: string, timeoutMs: number): Promise<ethers.TransactionReceipt | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const receipt = await this.provider.getTransactionReceipt(hash);
        if (receipt !== null) return receipt;
      } catch {
        // transient RPC error — keep polling
      }
      await sleep(Math.min(1500, Math.max(0, deadline - Date.now())));
    }
    return null;
  }

  private fail(message: string): ExecuteResult {
    this.consecutiveFailures++;
    log(`[live] FAILURE ${this.consecutiveFailures}/${this.config.maxConsecutiveFailures}: ${message}`);
    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.paused = true;
      log("[live] circuit breaker tripped — pausing live execution. Restart the process to resume.");
    }
    return { status: "error", message };
  }
}
