#!/usr/bin/env node
/**
 * Automated liquidation bot for Moonwell on Base mainnet.
 *
 * Discovery is two-tier:
 *  - HOT: users who just borrowed (Borrow events on each mToken in the last
 *    EVENT_LOOKBACK_BLOCKS blocks) — checked every cycle, cheap and fresh.
 *  - COLD: a borrower list from a Moonwell subgraph, swept every
 *    CANDIDATE_REFRESH_MIN minutes (set MOONWELL_SUBGRAPH_URL, e.g. a Goldsky
 *    deployment; the query below expects an `accounts` entity — adjust to your
 *    subgraph's schema if needed).
 *
 * Every liquidatable candidate is sized and executed through the shared
 * engine in executor.ts (Moonwell-exact math, slippage, simulation,
 * private submission, retries). Runs in DRY RUN mode unless
 * LIVE_EXECUTION=true is set.
 *
 * Usage:
 *   npx tsx watch.ts
 *   LIVE_EXECUTION=true npx tsx watch.ts
 */
import "dotenv/config";
import { ethers } from "ethers";
import { LiquidationExecutor, describeOpportunity, envNumber, loadConfig } from "./executor.js";
import type { Address } from "./types.js";

const CONFIG = {
  pollIntervalMs: envNumber("POLL_INTERVAL_SEC", 20) * 1000,
  candidateRefreshMs: envNumber("CANDIDATE_REFRESH_MIN", 5) * 60 * 1000,
  scanLimit: envNumber("SCAN_LIMIT", 300),
  eventLookbackBlocks: envNumber("EVENT_LOOKBACK_BLOCKS", 300),
  eventsEnabled: process.env.EVENT_DISCOVERY !== "false",
  subgraphEnabled: process.env.SUBGRAPH_DISCOVERY !== "false",
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ts = (): string => new Date().toISOString();
const log = (...args: unknown[]): void => console.log(`[${ts()}]`, ...args);
const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

let coldCandidates: Address[] = [];
let lastColdRefresh = 0;

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

async function pollCycle(executor: LiquidationExecutor): Promise<void> {
  const latest = await executor.provider.getBlockNumber();

  // Hot candidates: recent borrowers, refreshed every cycle (the lookback
  // window ages users out naturally).
  const hot: Address[] = CONFIG.eventsEnabled
    ? await fetchRecentBorrowers(executor, Math.max(0, latest - CONFIG.eventLookbackBlocks), latest)
    : [];

  // Cold candidates: subgraph borrower list, refreshed on a slow cadence.
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
    const result = await executor.execute(opp);
    log(`    -> ${result.status}${result.message ? `: ${result.message}` : ""}${result.txHash ? ` (${result.txHash})` : ""}`);
  }
}

async function main(): Promise<void> {
  const executor = new LiquidationExecutor(loadConfig());
  await executor.loadMarkets();
  log(`Loaded ${executor.marketCache.length} Moonwell markets.`);

  if (executor.config.liveExecution) {
    log(`*** LIVE EXECUTION ENABLED *** wallet: ${executor.walletAddress} contract: ${executor.config.arbAddress}`);
    log(
      executor.config.bloxrouteAuthHeader
        ? "Private submission: bloXroute blxr_tx (Base-Mainnet) + public fallback"
        : "Private submission: public mempool only (set BLOXROUTE_AUTH_HEADER for MEV protection)"
    );
  } else {
    log("Running in DRY RUN mode. Set LIVE_EXECUTION=true to send real transactions.");
  }

  log(
    `Poll every ${CONFIG.pollIntervalMs / 1000}s, events lookback ${CONFIG.eventLookbackBlocks} blocks, ` +
      `subgraph sweep every ${CONFIG.candidateRefreshMs / 60000}min, ` +
      `minProfit=$${executor.config.minProfitUsd}, minShortfall=$${executor.config.minCollateralUsd}`
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
