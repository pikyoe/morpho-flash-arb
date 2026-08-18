#!/usr/bin/env node
/**
 * Discovers candidate Moonwell Base borrowers and ranks them by Comptroller
 * shortfall (USD, 18-dec). `shortfall > 0` means the account is liquidatable.
 *
 * Candidates come from a Moonwell subgraph (set MOONWELL_SUBGRAPH_URL, e.g. a
 * Goldsky deployment; the query expects an `accounts` entity — adjust to your
 * subgraph's schema if needed).
 *
 * Usage:
 *   npx tsx scanBorrowers.ts [--limit 200] [--watchlist 5000]
 */
import "dotenv/config";
import { ethers } from "ethers";
import { ADDRESSES } from "./addresses.js";
import { MOONWELL_COMPTROLLER_ABI } from "./abi.js";
import type { Address, HealthCheckResult } from "./types.js";

interface Args {
  limit: number;
  watchlistUsd: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = { limit: 200, watchlistUsd: 5000 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") {
      const v = args[++i];
      if (v !== undefined) out.limit = parseInt(v, 10);
    } else if (args[i] === "--watchlist") {
      const v = args[++i];
      if (v !== undefined) out.watchlistUsd = parseFloat(v);
    }
  }
  return out;
}

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

  return json.data.accounts.map((u) => u.id);
}

async function checkHealthFactors(
  provider: ethers.JsonRpcProvider,
  addresses: Address[]
): Promise<HealthCheckResult[]> {
  const comptroller = new ethers.Contract(ADDRESSES.MOONWELL_COMPTROLLER!, MOONWELL_COMPTROLLER_ABI, provider);

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
  const subgraphUrl = process.env.MOONWELL_SUBGRAPH_URL;
  if (!subgraphUrl) {
    throw new Error("Set MOONWELL_SUBGRAPH_URL in your .env (a Moonwell subgraph endpoint, e.g. Goldsky)");
  }

  const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const provider = new ethers.JsonRpcProvider(rpcUrl, 8453, {
    staticNetwork: true,
    batchMaxCount: 1,
  });

  console.log(`Fetching up to ${args.limit} borrower candidates from the subgraph...`);
  const candidates = await fetchBorrowerCandidates(subgraphUrl, args.limit);
  console.log(`Got ${candidates.length} candidates. Checking on-chain health (Comptroller.getAccountLiquidity)...`);

  const results = await checkHealthFactors(provider, candidates);
  console.error("");

  const watchlistUsdWei = BigInt(Math.floor(args.watchlistUsd * 1e18));

  const liquidatable: HealthCheckResult[] = [];
  const watchlist: HealthCheckResult[] = [];

  for (const r of results) {
    if (r.error || r.shortfall === undefined) continue;
    if (r.shortfall > 0n) {
      liquidatable.push(r);
    } else if ((r.liquidity ?? 0n) < watchlistUsdWei) {
      watchlist.push(r);
    }
  }

  const byShortfall = (a: HealthCheckResult, b: HealthCheckResult): number =>
    a.shortfall! > b.shortfall! ? -1 : 1;

  liquidatable.sort(byShortfall);
  watchlist.sort((a, b) => (a.liquidity! < b.liquidity! ? -1 : 1));

  console.log(`\n=== LIQUIDATABLE NOW (Comptroller shortfall > 0) ===`);
  if (liquidatable.length === 0) console.log("(none among checked candidates)");
  for (const r of liquidatable) {
    console.log(`${r.address}  shortfall=$${ethers.formatUnits(r.shortfall!, 18)}`);
  }

  console.log(`\n=== WATCHLIST (healthy, liquidity < $${args.watchlistUsd}) ===`);
  if (watchlist.length === 0) console.log("(none among checked candidates)");
  for (const r of watchlist) {
    console.log(`${r.address}  liquidity=$${ethers.formatUnits(r.liquidity ?? 0n, 18)}`);
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
