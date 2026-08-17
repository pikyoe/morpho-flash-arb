#!/usr/bin/env node
/**
 * Discovers candidate Aave V3 Base borrowers and ranks them by health factor.
 *
 * Usage:
 *   npx tsx scanBorrowers.ts [--limit 200] [--threshold 1.05]
 */
import "dotenv/config";
import { ethers } from "ethers";
import { ADDRESSES } from "./addresses.js";
import { AAVE_V3_POOL_ABI } from "./abi.js";
import type { Address, HealthCheckResult } from "./types.js";

const SUBGRAPH_ID = "GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF";

interface Args {
  limit: number;
  threshold: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = { limit: 200, threshold: 1.05 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") {
      const v = args[++i];
      if (v !== undefined) out.limit = parseInt(v, 10);
    } else if (args[i] === "--threshold") {
      const v = args[++i];
      if (v !== undefined) out.threshold = parseFloat(v);
    }
  }
  return out;
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
      ) {
        id
      }
    }
  `;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { first: Math.min(limit, 1000) } }),
  });

  if (!res.ok) {
    throw new Error(`Subgraph query failed: HTTP ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as SubgraphResponse;
  if (json.errors) {
    throw new Error(`Subgraph returned errors: ${JSON.stringify(json.errors)}`);
  }
  if (!json.data) {
    throw new Error("Subgraph response missing 'data' field");
  }

  return json.data.users.map((u) => u.id);
}

async function checkHealthFactors(
  provider: ethers.JsonRpcProvider,
  addresses: Address[]
): Promise<HealthCheckResult[]> {
  const pool = new ethers.Contract(ADDRESSES.AAVE_V3_POOL!, AAVE_V3_POOL_ABI, provider);

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
    process.stderr.write(`Checked ${Math.min(i + CONCURRENCY, addresses.length)}/${addresses.length}\r`);
  }

  return results;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const apiKey = process.env.GRAPH_API_KEY;
  if (!apiKey) {
    throw new Error("Set GRAPH_API_KEY in your .env — get a free key at https://thegraph.com/studio");
  }

  const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const provider = new ethers.JsonRpcProvider(rpcUrl, 8453, {
    staticNetwork: true,
    batchMaxCount: 1,
  });

  console.log(`Fetching up to ${args.limit} borrower candidates from the subgraph...`);
  const candidates = await fetchBorrowerCandidates(apiKey, args.limit);
  console.log(`Got ${candidates.length} candidates. Checking on-chain health factors...`);

  const results = await checkHealthFactors(provider, candidates);
  console.error("");

  const ONE = 1e18;
  const thresholdWei = BigInt(Math.floor(args.threshold * ONE));

  const liquidatable: HealthCheckResult[] = [];
  const watchlist: HealthCheckResult[] = [];

  for (const r of results) {
    if (r.error || r.healthFactor === undefined) continue;
    if (r.healthFactor === 0n) continue;
    if (r.healthFactor < BigInt(ONE)) {
      liquidatable.push(r);
    } else if (r.healthFactor < thresholdWei) {
      watchlist.push(r);
    }
  }

  const byHealthFactor = (a: HealthCheckResult, b: HealthCheckResult): number =>
    a.healthFactor! < b.healthFactor! ? -1 : 1;

  liquidatable.sort(byHealthFactor);
  watchlist.sort(byHealthFactor);

  console.log(`\n=== LIQUIDATABLE NOW (healthFactor < 1.0) ===`);
  if (liquidatable.length === 0) console.log("(none among checked candidates)");
  for (const r of liquidatable) {
    console.log(`${r.address}  HF=${ethers.formatUnits(r.healthFactor!, 18)}`);
  }

  console.log(`\n=== WATCHLIST (1.0 <= healthFactor < ${args.threshold}) ===`);
  if (watchlist.length === 0) console.log("(none among checked candidates)");
  for (const r of watchlist) {
    const collateral = r.collateralUsd !== undefined ? ethers.formatUnits(r.collateralUsd, 8) : "?";
    console.log(`${r.address}  HF=${ethers.formatUnits(r.healthFactor!, 18)}  Collateral=$${collateral}`);
  }

  console.log(
    `\nNext step: for any address above, run checkPosition.ts with the actual ` +
      `collateral/debt assets and amounts for that user to size and price the route.`
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
