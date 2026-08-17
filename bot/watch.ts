#!/usr/bin/env node
/**
 * Automated polling bot: periodically scans for liquidatable Aave V3 Base
 * positions, prices the DEX-side exit, and (optionally) auto-executes via
 * FlashLoanArbitrage.executeArbitrage.
 *
 * SAFETY DEFAULTS — see README.md. Runs in DRY RUN mode unless
 * LIVE_EXECUTION=true is set in .env.
 *
 * Usage:
 *   npx tsx watch.ts
 *   LIVE_EXECUTION=true npx tsx watch.ts
 */
import "dotenv/config";
import { ethers } from "ethers";
import { ADDRESSES } from "./addresses.js";
import {
  AAVE_V3_POOL_ABI,
  AAVE_POOL_RESERVES_ABI,
  AERODROME_ROUTER_ABI,
  ERC20_ABI,
  FLASH_LOAN_ARBITRAGE_ABI,
  AAVE_ORACLE_ABI,
} from "./abi.js";
import type {
  Address,
  ReserveInfo,
  PositionEntry,
  UserPosition,
  HealthCheckResult,
  ArbitrageCall,
  PriceMap,
  WatchConfig,
} from "./types.js";

const SUBGRAPH_ID = "GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF";

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  return raw !== undefined ? Number(raw) : fallback;
}

const CONFIG: WatchConfig = {
  pollIntervalMs: envNumber("POLL_INTERVAL_SEC", 20) * 1000,
  candidateRefreshMs: envNumber("CANDIDATE_REFRESH_MIN", 5) * 60 * 1000,
  scanLimit: envNumber("SCAN_LIMIT", 300),
  minCollateralUsd: envNumber("MIN_COLLATERAL_USD", 100),
  minProfitUsd: envNumber("MIN_PROFIT_USD", 1),
  maxGasPriceGwei: envNumber("MAX_GAS_PRICE_GWEI", 5),
  minWalletEthBalance: envNumber("MIN_WALLET_ETH_BALANCE", 0.005),
  maxConsecutiveFailures: envNumber("MAX_CONSECUTIVE_FAILURES", 3),
  liveExecution: process.env.LIVE_EXECUTION === "true",
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ts = (): string => new Date().toISOString();
const log = (...args: unknown[]): void => console.log(`[${ts()}]`, ...args);

// --- Circuit breaker state ---
let consecutiveFailures = 0;
let paused = false;

// --- Candidate cache ---
let candidateCache: Address[] = [];
let lastCandidateRefresh = 0;

// --- Reserve metadata cache (fetched once at startup) ---
let reserveCache: ReserveInfo[] = [];

interface BotContext {
  provider: ethers.JsonRpcProvider;
  pool: ethers.Contract;
  oracle: ethers.Contract;
  router: ethers.Contract;
  arbContract: ethers.Contract | null;
  wallet: ethers.Wallet | null;
}

interface SubgraphUser {
  id: string;
}

interface SubgraphResponse {
  data?: { users: SubgraphUser[] };
  errors?: unknown;
}

async function fetchBorrowerCandidates(apiKey: string, limit: number): Promise<Address[]> {
  const url = `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${SUBGRAPH_ID}`;
  const query = `
    query BorrowCandidates($first: Int!) {
      users(
        first: $first
        where: { borrowedReservesCount_gt: 0 }
        orderBy: borrowedReservesCount
        orderDirection: desc
      ) { id }
    }
  `;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { first: Math.min(limit, 1000) } }),
  });
  if (!res.ok) throw new Error(`Subgraph query failed: HTTP ${res.status}`);
  const json = (await res.json()) as SubgraphResponse;
  if (json.errors) throw new Error(`Subgraph errors: ${JSON.stringify(json.errors)}`);
  if (!json.data) throw new Error("Subgraph response missing 'data' field");
  return json.data.users.map((u) => u.id);
}

async function loadReserveCache(
  reservePool: ethers.Contract,
  provider: ethers.JsonRpcProvider
): Promise<ReserveInfo[]> {
  const reserves = (await reservePool.getReservesList!()) as Address[];
  const CONCURRENCY = 8;
  const out: ReserveInfo[] = [];
  for (let i = 0; i < reserves.length; i += CONCURRENCY) {
    const batch = reserves.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (asset): Promise<ReserveInfo> => {
        const reserveData = await reservePool.getReserveData!(asset);
        const token = new ethers.Contract(asset, ERC20_ABI, provider);
        const [symbol, decimals] = (await Promise.all([token.symbol!(), token.decimals!()])) as [string, number];
        return {
          asset,
          symbol,
          decimals: Number(decimals),
          aTokenAddress: reserveData.aTokenAddress as Address,
          variableDebtTokenAddress: reserveData.variableDebtTokenAddress as Address,
        };
      })
    );
    out.push(...results);
  }
  return out;
}

async function checkHealthFactors(pool: ethers.Contract, addresses: Address[]): Promise<HealthCheckResult[]> {
  const CONCURRENCY = 10;
  const results: HealthCheckResult[] = [];
  for (let i = 0; i < addresses.length; i += CONCURRENCY) {
    const batch = addresses.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (addr): Promise<HealthCheckResult> => {
        try {
          const data = await pool.getUserAccountData!(addr);
          return {
            address: addr,
            healthFactor: data.healthFactor as bigint,
            collateralUsd: data.totalCollateralBase as bigint,
          };
        } catch (err) {
          return { address: addr, error: err instanceof Error ? err.message : String(err) };
        }
      })
    );
    results.push(...batchResults);
  }
  return results;
}

async function getBestPositionPair(provider: ethers.JsonRpcProvider, user: Address): Promise<UserPosition | null> {
  const CONCURRENCY = 8;
  const collateral: PositionEntry[] = [];
  const debt: PositionEntry[] = [];

  for (let i = 0; i < reserveCache.length; i += CONCURRENCY) {
    const batch = reserveCache.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (r) => {
        const aToken = new ethers.Contract(r.aTokenAddress, ERC20_ABI, provider);
        const debtToken = new ethers.Contract(r.variableDebtTokenAddress, ERC20_ABI, provider);
        const [aBal, debtBal] = (await Promise.all([aToken.balanceOf!(user), debtToken.balanceOf!(user)])) as [
          bigint,
          bigint,
        ];
        if (aBal > 0n) collateral.push({ ...r, amount: aBal });
        if (debtBal > 0n) debt.push({ ...r, amount: debtBal });
      })
    );
  }

  if (collateral.length === 0 || debt.length === 0) return null;
  return { collateral, debt };
}

async function priceReservesUsd(oracle: ethers.Contract, reserves: PositionEntry[]): Promise<PriceMap> {
  const prices: PriceMap = {};
  await Promise.all(
    reserves.map(async (r) => {
      prices[r.asset] = (await oracle.getAssetPrice!(r.asset)) as bigint;
    })
  );
  return prices;
}

function pickLargestByUsd(entries: PositionEntry[], prices: PriceMap): PositionEntry | null {
  let best: PositionEntry | null = null;
  let bestUsd = -1n;
  for (const e of entries) {
    const price = prices[e.asset];
    if (price === undefined) continue;
    const usd = (e.amount * price) / 10n ** BigInt(e.decimals);
    if (usd > bestUsd) {
      bestUsd = usd;
      best = e;
    }
  }
  return best;
}

async function evaluateAndMaybeExecute(ctx: BotContext, candidate: HealthCheckResult): Promise<void> {
  const { provider, oracle, router, arbContract, wallet } = ctx;

  const position = await getBestPositionPair(provider, candidate.address);
  if (!position) {
    log(`  ${candidate.address}: no readable collateral/debt breakdown, skipping`);
    return;
  }

  const relevantAssets = [...position.collateral, ...position.debt];
  const prices = await priceReservesUsd(oracle, relevantAssets);

  const debtLeg = pickLargestByUsd(position.debt, prices);
  const collateralLeg = pickLargestByUsd(position.collateral, prices);
  if (!debtLeg || !collateralLeg) return;

  const debtPrice = prices[debtLeg.asset];
  const collateralPrice = prices[collateralLeg.asset];
  if (debtPrice === undefined || collateralPrice === undefined) return;

  const debtToCover = debtLeg.amount / 2n;
  const bonusBps = 10_500n; // 5% — TODO: replace with real per-reserve liquidationBonus decode.

  const collateralUnit = 10n ** BigInt(collateralLeg.decimals);
  const debtUnit = 10n ** BigInt(debtLeg.decimals);

  const seizedCollateralEstimate =
    (debtToCover * debtPrice * collateralUnit * bonusBps) / (collateralPrice * debtUnit * 10_000n);

  const routes = [
    { from: collateralLeg.asset, to: debtLeg.asset, stable: false, factory: ADDRESSES.AERODROME_POOL_FACTORY! },
  ];

  let dexProceeds: bigint;
  try {
    const amountsOut = (await router.getAmountsOut!(seizedCollateralEstimate, routes)) as bigint[];
    dexProceeds = amountsOut[amountsOut.length - 1]!;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`  ${candidate.address}: Aerodrome quote failed (likely no direct pool) — ${msg}`);
    return;
  }

  const profitDebtUnits = dexProceeds - debtToCover;
  const profitUsd = Number(ethers.formatUnits((profitDebtUnits * debtPrice) / debtUnit, 8));

  log(
    `  ${candidate.address}: liquidate ${ethers.formatUnits(debtToCover, debtLeg.decimals)} ` +
      `${debtLeg.symbol} debt -> seize ~${ethers.formatUnits(seizedCollateralEstimate, collateralLeg.decimals)} ` +
      `${collateralLeg.symbol} -> sell for ~${ethers.formatUnits(dexProceeds, debtLeg.decimals)} ${debtLeg.symbol} ` +
      `=> est. profit $${profitUsd.toFixed(2)}`
  );

  if (profitUsd < CONFIG.minProfitUsd) {
    log(`  -> below MIN_PROFIT_USD ($${CONFIG.minProfitUsd}), skipping`);
    return;
  }

  if (!CONFIG.liveExecution) {
    log(`  -> [DRY RUN] would execute now. Set LIVE_EXECUTION=true to actually send this.`);
    return;
  }

  if (paused) {
    log(`  -> circuit breaker is PAUSED, skipping execution`);
    return;
  }

  if (!arbContract || !wallet) {
    log(`  -> LIVE_EXECUTION is on but contract/wallet not initialized — this should not happen`);
    return;
  }

  const feeData = await provider.getFeeData();
  const gasPriceGwei = Number(ethers.formatUnits(feeData.gasPrice ?? 0n, "gwei"));
  if (gasPriceGwei > CONFIG.maxGasPriceGwei) {
    log(`  -> gas price ${gasPriceGwei.toFixed(3)} gwei exceeds cap, skipping`);
    return;
  }

  const balance = await provider.getBalance(wallet.address);
  if (Number(ethers.formatEther(balance)) < CONFIG.minWalletEthBalance) {
    log(`  -> wallet ETH balance below floor, pausing live execution`);
    paused = true;
    return;
  }

  const deadline = Math.floor(Date.now() / 1000) + 300;
  const erc20Iface = new ethers.Interface(ERC20_ABI);
  const poolIface = new ethers.Interface(AAVE_V3_POOL_ABI);
  const routerIface = new ethers.Interface(AERODROME_ROUTER_ABI);

  const calls: ArbitrageCall[] = [
    {
      target: ADDRESSES.AAVE_V3_POOL!,
      value: 0n,
      data: poolIface.encodeFunctionData("liquidationCall", [
        collateralLeg.asset,
        debtLeg.asset,
        candidate.address,
        debtToCover,
        false,
      ]),
    },
    {
      target: collateralLeg.asset,
      value: 0n,
      data: erc20Iface.encodeFunctionData("approve", [ADDRESSES.AERODROME_ROUTER, seizedCollateralEstimate]),
    },
    {
      target: ADDRESSES.AERODROME_ROUTER!,
      value: 0n,
      data: routerIface.encodeFunctionData("swapExactTokensForTokens", [
        seizedCollateralEstimate,
        (dexProceeds * 99n) / 100n,
        routes,
        arbContract.target,
        deadline,
      ]),
    },
  ];

  const minProfitInDebtUnits = (BigInt(Math.floor(CONFIG.minProfitUsd * 1e8)) * debtUnit) / debtPrice;

  try {
    log(`  -> LIVE: submitting executeArbitrage...`);
    const tx = await arbContract.executeArbitrage!(debtLeg.asset, debtToCover, calls, minProfitInDebtUnits);
    log(`  -> tx sent: ${tx.hash}`);
    const receipt = await tx.wait();
    log(`  -> confirmed in block ${receipt.blockNumber}`);
    consecutiveFailures = 0;
  } catch (err) {
    consecutiveFailures++;
    const msg = err instanceof Error ? err.message : String(err);
    log(`  -> execution FAILED (${consecutiveFailures}/${CONFIG.maxConsecutiveFailures}): ${msg}`);
    if (consecutiveFailures >= CONFIG.maxConsecutiveFailures) {
      paused = true;
      log(`  -> circuit breaker tripped. Pausing live execution. Restart the process to resume.`);
    }
  }
}

async function pollCycle(ctx: BotContext): Promise<void> {
  const now = Date.now();

  if (now - lastCandidateRefresh > CONFIG.candidateRefreshMs || candidateCache.length === 0) {
    log(`Refreshing candidate list from subgraph (limit=${CONFIG.scanLimit})...`);
    try {
      const apiKey = process.env.GRAPH_API_KEY;
      if (!apiKey) throw new Error("GRAPH_API_KEY not set");
      candidateCache = await fetchBorrowerCandidates(apiKey, CONFIG.scanLimit);
      lastCandidateRefresh = now;
      log(`Got ${candidateCache.length} candidates.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Candidate refresh failed: ${msg} (using stale cache of ${candidateCache.length})`);
    }
  }

  if (candidateCache.length === 0) return;

  const healthResults = await checkHealthFactors(ctx.pool, candidateCache);
  const ONE = 10n ** 18n;
  const minCollateralWei = BigInt(Math.floor(CONFIG.minCollateralUsd * 1e8));

  const liquidatable = healthResults
    .filter((r): r is HealthCheckResult & { healthFactor: bigint; collateralUsd: bigint } =>
      r.error === undefined && r.healthFactor !== undefined && r.collateralUsd !== undefined
    )
    .filter((r) => r.healthFactor > 0n)
    .filter((r) => r.healthFactor < ONE)
    .filter((r) => r.collateralUsd >= minCollateralWei)
    .sort((a, b) => (a.healthFactor < b.healthFactor ? -1 : 1));

  if (liquidatable.length === 0) {
    log(`No liquidatable positions above $${CONFIG.minCollateralUsd} this cycle.`);
    return;
  }

  log(`${liquidatable.length} liquidatable position(s) found:`);
  for (const candidate of liquidatable) {
    await evaluateAndMaybeExecute(ctx, candidate);
  }
}

async function main(): Promise<void> {
  if (!process.env.GRAPH_API_KEY) {
    throw new Error("Set GRAPH_API_KEY in .env — get a free key at https://thegraph.com/studio");
  }

  const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const provider = new ethers.JsonRpcProvider(rpcUrl, 8453, {
    staticNetwork: true,
    batchMaxCount: 1,
  });

  const pool = new ethers.Contract(ADDRESSES.AAVE_V3_POOL!, AAVE_V3_POOL_ABI, provider);
  const reservePool = new ethers.Contract(ADDRESSES.AAVE_V3_POOL!, AAVE_POOL_RESERVES_ABI, provider);
  const oracle = new ethers.Contract(ADDRESSES.AAVE_V3_ORACLE!, AAVE_ORACLE_ABI, provider);
  const router = new ethers.Contract(ADDRESSES.AERODROME_ROUTER!, AERODROME_ROUTER_ABI, provider);

  let wallet: ethers.Wallet | null = null;
  let arbContract: ethers.Contract | null = null;

  if (CONFIG.liveExecution) {
    const privateKey = process.env.PRIVATE_KEY;
    const arbAddress = process.env.ARBITRAGE_CONTRACT_ADDRESS;
    if (!privateKey) throw new Error("LIVE_EXECUTION=true requires PRIVATE_KEY in .env");
    if (!arbAddress) throw new Error("LIVE_EXECUTION=true requires ARBITRAGE_CONTRACT_ADDRESS in .env");
    wallet = new ethers.Wallet(privateKey, provider);
    arbContract = new ethers.Contract(arbAddress, FLASH_LOAN_ARBITRAGE_ABI, wallet);
    log(`*** LIVE EXECUTION ENABLED *** wallet: ${wallet.address}`);
  } else {
    log(`Running in DRY RUN mode. Set LIVE_EXECUTION=true in .env to send real transactions.`);
  }

  log(`Loading Aave reserve metadata (once)...`);
  reserveCache = await loadReserveCache(reservePool, provider);
  log(`Loaded ${reserveCache.length} reserves.`);

  const ctx: BotContext = { provider, pool, oracle, router, arbContract, wallet };

  process.on("SIGINT", () => {
    log("Shutting down.");
    process.exit(0);
  });

  log(
    `Starting poll loop: every ${CONFIG.pollIntervalMs / 1000}s, ` +
      `candidates refreshed every ${CONFIG.candidateRefreshMs / 60000}min, ` +
      `minProfit=$${CONFIG.minProfitUsd}, minCollateral=$${CONFIG.minCollateralUsd}`
  );

  for (;;) {
    try {
      await pollCycle(ctx);
    } catch (err) {
      const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
      log(`Poll cycle error: ${msg}`);
    }
    await sleep(CONFIG.pollIntervalMs);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
