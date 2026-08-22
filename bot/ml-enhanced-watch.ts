#!/usr/bin/env node
/**
 * ML-Enhanced liquidation bot for Moonwell on Base mainnet.
 *
 * Same discovery + execution pipeline as watch.ts, but every opportunity is
 * first passed through the ML prediction service (liquidation probability,
 * profitability, competition intensity). The ML layer is a GATE ONLY: it can
 * block or delay an execution, it never sizes or constructs the transaction —
 * that is done by executor.ts with the exact on-chain math.
 *
 * ML is opt-in: set ML_ENABLED=true. The bundled models are mock/random, so
 * keep ML_ENABLED=false (the default) for real mainnet execution.
 *
 * Usage:
 *   npx tsx ml-enhanced-watch.ts
 *   LIVE_EXECUTION=true npx tsx ml-enhanced-watch.ts
 */
import "dotenv/config";
import { ethers } from "ethers";
import { LiquidationExecutor, describeOpportunity, envNumber, loadConfig } from "./executor.js";
import { PredictionService } from "./ml/prediction-service.js";
import type { MLOpportunityPrediction as MlOpp } from "./ml/prediction-service.js";
import type { Address, Opportunity } from "./types.js";

const CONFIG = {
  pollIntervalMs: envNumber("POLL_INTERVAL_SEC", 20) * 1000,
  candidateRefreshMs: envNumber("CANDIDATE_REFRESH_MIN", 5) * 60 * 1000,
  scanLimit: envNumber("SCAN_LIMIT", 300),
  eventLookbackBlocks: envNumber("EVENT_LOOKBACK_BLOCKS", 300),
  eventsEnabled: process.env.EVENT_DISCOVERY !== "false",
  subgraphEnabled: process.env.SUBGRAPH_DISCOVERY !== "false",
};

// ML-specific configuration
const ML_CONFIG = {
  enabled: process.env.ML_ENABLED === "true", // Opt-in: the bundled models are mock — see bot/ml/architecture.md
  minConfidence: envNumber("ML_MIN_CONFIDENCE", 0.7),
  minOverallScore: envNumber("ML_MIN_OVERALL_SCORE", 0.6),
  useMLTiming: process.env.ML_USE_TIMING !== "false",
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ts = (): string => new Date().toISOString();
const log = (...args: unknown[]): void => console.log(`[${ts()}]`, ...args);
const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

let coldCandidates: Address[] = [];
let lastColdRefresh = 0;
let predictionService: PredictionService | null = null;

interface SubgraphUser {
  id: string;
}

interface SubgraphResponse {
  data?: { accounts: SubgraphUser[] };
  errors?: unknown;
}

async function fetchBorrowerCandidates(subgraphUrl: string, limit: number): Promise<Address[]> {
  const query = `
    query BorrowCandidates($first: Int!) {
      accounts(first: $first) { id }
    }
  `;
  const res = await fetch(subgraphUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { first: Math.min(limit, 1000) } }),
  });
  if (!res.ok) throw new Error(`Subgraph query failed: HTTP ${res.status}`);
  const json = (await res.json()) as SubgraphResponse;
  if (json.errors) throw new Error(`Subgraph errors: ${JSON.stringify(json.errors)}`);
  if (!json.data) throw new Error("Subgraph response missing 'data' field");
  return json.data.accounts.map((u) => u.id);
}

/** HOT discovery: every address that borrowed on any scanned mToken in the lookback window. */
async function fetchRecentBorrowers(
  executor: LiquidationExecutor,
  fromBlock: number,
  toBlock: number
): Promise<Address[]> {
  try {
    const users = new Set<Address>();
    for (const market of executor.markets) {
      const events = await market.queryFilter("Borrow", fromBlock, toBlock);
      for (const e of events) {
        const borrower = "args" in e ? e.args?.[0] : undefined;
        if (typeof borrower === "string" && ethers.isAddress(borrower)) {
          users.add(ethers.getAddress(borrower));
        }
      }
    }
    return [...users];
  } catch (err) {
    log(`Borrow event scan failed: ${msg(err)}`);
    return [];
  }
}

/** Gate an opportunity through the ML service. Returns a priority fee override, or null to skip. */
async function mlGate(opp: Opportunity): Promise<number | null> {
  if (!ML_CONFIG.enabled || !predictionService) return null;

  try {
    const priceMap = new Map<string, number>();
    for (const [mToken, price] of Object.entries(opp.prices)) {
      priceMap.set(mToken, Number(ethers.formatUnits(price, 18)));
    }

    const prediction: MlOpp = await predictionService.predictOpportunity(
      opp.user,
      opp.position.collateral,
      opp.position.debt,
      opp.healthFactor,
      priceMap,
      { asset: opp.debtAsset, amount: opp.debtToCover, minProfit: opp.profitDebtUnits }
    );

    log(
      `  ML: score ${(prediction.overallScore * 100).toFixed(1)}%, confidence ` +
        `${(prediction.confidence * 100).toFixed(1)}%, recommendation ${prediction.recommendation}`
    );

    if (prediction.confidence < ML_CONFIG.minConfidence) {
      log(`  -> ML confidence below ${(ML_CONFIG.minConfidence * 100).toFixed(1)}%, skipping`);
      return null;
    }
    if (prediction.overallScore < ML_CONFIG.minOverallScore) {
      log(`  -> ML score below ${(ML_CONFIG.minOverallScore * 100).toFixed(1)}%, skipping`);
      return null;
    }
    if (prediction.recommendation === "skip") {
      log("  -> ML recommendation: SKIP, skipping");
      return null;
    }
    if (ML_CONFIG.useMLTiming && prediction.recommendation === "wait") {
      const waitTime = prediction.competition.optimalTiming - Date.now();
      if (waitTime > 0 && waitTime < 60000) {
        log(`  -> ML recommendation: WAIT ${waitTime}ms for optimal timing`);
        await sleep(waitTime);
      }
    }

    // Use ML's recommended priority fee (gwei) if it has one.
    const fee = prediction.competition.recommendedPriorityFee;
    return fee > 0 ? fee : null;
  } catch (err) {
    log(`  ML prediction failed: ${msg(err)} — proceeding without ML gate`);
    return null;
  }
}

async function pollCycle(executor: LiquidationExecutor): Promise<void> {
  const latest = await executor.provider.getBlockNumber();

  const hot: Address[] = CONFIG.eventsEnabled
    ? await fetchRecentBorrowers(executor, Math.max(0, latest - CONFIG.eventLookbackBlocks), latest)
    : [];

  if (
    CONFIG.subgraphEnabled &&
    (coldCandidates.length === 0 || Date.now() - lastColdRefresh > CONFIG.candidateRefreshMs)
  ) {
    const subgraphUrl = process.env.MOONWELL_SUBGRAPH_URL;
    if (!subgraphUrl) {
      log("MOONWELL_SUBGRAPH_URL not set — subgraph sweep disabled (event discovery still active)");
      coldCandidates = [];
      lastColdRefresh = Date.now();
    } else {
      log(`Refreshing subgraph candidate list (limit=${CONFIG.scanLimit})...`);
      try {
        coldCandidates = await fetchBorrowerCandidates(subgraphUrl, CONFIG.scanLimit);
        lastColdRefresh = Date.now();
        log(`Got ${coldCandidates.length} subgraph candidates.`);
      } catch (err) {
        log(`Subgraph refresh failed: ${msg(err)} (using stale cache of ${coldCandidates.length})`);
      }
    }
  }

  const seen = new Set<string>();
  const candidates: Address[] = [];
  for (const a of [...hot, ...coldCandidates]) {
    const key = a.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(a);
    }
  }

  if (candidates.length === 0) {
    log("No candidates to check this cycle.");
    return;
  }

  const liquidatable = await executor.findLiquidatable(candidates);
  if (liquidatable.length === 0) {
    log(`Checked ${candidates.length} candidates (${hot.length} hot) — none liquidatable.`);
    return;
  }

  log(`${liquidatable.length} liquidatable position(s) from ${candidates.length} candidates:`);
  for (const c of liquidatable) {
    log(`  ${c.address} shortfall=$${ethers.formatUnits(c.shortfall!, 18)}`);
    const opp = await executor.evaluate(c.address);
    if (!opp) {
      log("    -> not executable (no pair/route, or below MIN_PROFIT_USD)");
      continue;
    }
    log(`    -> ${describeOpportunity(opp)}`);
    const priorityFeeGwei = await mlGate(opp);
    if (ML_CONFIG.enabled && priorityFeeGwei === null) continue; // ML blocked it
    const result = await executor.execute(opp, {
      ...(priorityFeeGwei !== null && priorityFeeGwei !== undefined ? { priorityFeeGwei } : {}),
    });
    log(`    -> ${result.status}${result.message ? `: ${result.message}` : ""}${result.txHash ? ` (${result.txHash})` : ""}`);
  }
}

async function main(): Promise<void> {
  const executor = new LiquidationExecutor(loadConfig());
  await executor.loadMarkets();
  log(`Loaded ${executor.marketCache.length} Moonwell markets.`);

  if (executor.config.liveExecution) {
    log(`*** LIVE EXECUTION ENABLED *** wallet: ${executor.walletAddress} contract: ${executor.config.arbAddress}`);
  } else {
    log("Running in DRY RUN mode. Set LIVE_EXECUTION=true to send real transactions.");
  }

  if (ML_CONFIG.enabled) {
    log(
      `ML gate ENABLED (minConfidence=${(ML_CONFIG.minConfidence * 100).toFixed(1)}%, ` +
        `minScore=${(ML_CONFIG.minOverallScore * 100).toFixed(1)}%)`
    );
    try {
      predictionService = new PredictionService(executor.provider);
      await predictionService.loadModels();
      log("ML components initialized.");
    } catch (err) {
      log(`ML initialization failed: ${msg(err)} — running without ML gate`);
      ML_CONFIG.enabled = false;
    }
  } else {
    log("ML gate DISABLED (set ML_ENABLED=true to enable — models are mock, keep disabled for mainnet).");
  }

  log(
    `Poll every ${CONFIG.pollIntervalMs / 1000}s, events lookback ${CONFIG.eventLookbackBlocks} blocks, ` +
      `subgraph sweep every ${CONFIG.candidateRefreshMs / 60000}min, ` +
      `minProfit=$${executor.config.minProfitUsd}, minCollateral=$${executor.config.minCollateralUsd}`
  );

  process.on("SIGINT", () => {
    log("Shutting down.");
    process.exit(0);
  });

  for (;;) {
    try {
      await pollCycle(executor);
    } catch (err) {
      log(`Poll cycle error: ${msg(err)}`);
    }
    await sleep(CONFIG.pollIntervalMs);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
