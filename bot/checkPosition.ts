#!/usr/bin/env node
/**
 * Manual CLI: check one Moonwell position on Base mainnet, size the liquidation
 * with the exact on-chain math (close factor, liquidation incentive, protocol
 * seize share, collateral cap), price the DEX exit, and optionally submit.
 *
 * Uses the same execution engine as the watch bot (bot/executor.ts), so the
 * manual path is exactly as safe as the automated one.
 *
 * Usage:
 *   npx tsx checkPosition.ts --user 0xBorrowerAddress \
 *     --debtAsset USDC --collateralAsset WETH \
 *     [--debtToCover 1000000000] [--execute]
 *
 * NOTE: the liquidation parameters are read on-chain from the Moonwell
 * Comptroller — `--bonusBps` is accepted for backward compatibility but ignored.
 */
import "dotenv/config";
import { ethers } from "ethers";
import { LiquidationExecutor, describeOpportunity, loadConfig } from "./executor.js";
import type { Address, PositionEntry } from "./types.js";

interface Args {
  execute: boolean;
  user: Address;
  debtAsset: string | undefined;
  collateralAsset: string | undefined;
  debtToCover: bigint | undefined;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = { execute: false, user: "", debtAsset: undefined, collateralAsset: undefined, debtToCover: undefined };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--execute") out.execute = true;
    else if (a === "--user") out.user = args[++i] ?? "";
    else if (a === "--debtAsset") out.debtAsset = args[++i];
    else if (a === "--collateralAsset") out.collateralAsset = args[++i];
    else if (a === "--debtToCover") {
      const v = args[++i];
      if (v !== undefined) out.debtToCover = BigInt(v);
    } else if (a === "--bonusBps") {
      console.warn("note: --bonusBps is ignored — the liquidation incentive is read on-chain from the Moonwell Comptroller.");
      i++; // consume the value
    }
  }
  if (!out.user || !ethers.isAddress(out.user)) {
    console.error(
      "Usage: node checkPosition.ts --user <addr> [--debtAsset <sym|addr>] [--collateralAsset <sym|addr>] " +
        "[--debtToCover <amountRaw>] [--execute]"
    );
    process.exit(1);
  }
  return out;
}

function findEntry(entries: PositionEntry[], arg: string | undefined): PositionEntry | null {
  if (!arg) return null;
  const target = arg.toLowerCase();
  const bySymbol = entries.find((e) => e.symbol.toLowerCase() === target);
  if (bySymbol) return bySymbol;
  const byAddress = entries.find((e) => e.asset.toLowerCase() === target);
  return byAddress ?? null;
}

function logPosition(user: Address, position: { collateral: PositionEntry[]; debt: PositionEntry[] }): void {
  console.log(`\n=== Position breakdown for ${user} ===`);
  console.log("Collateral:");
  for (const c of position.collateral) {
    console.log(`  ${c.symbol.padEnd(8)} ${ethers.formatUnits(c.amount, c.decimals)}  (${c.asset})`);
  }
  console.log("Debt:");
  for (const d of position.debt) {
    console.log(`  ${d.symbol.padEnd(8)} ${ethers.formatUnits(d.amount, d.decimals)}  (${d.asset})`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const executor = new LiquidationExecutor(loadConfig());
  await executor.loadMarkets();

  const position = await executor.getPosition(args.user);
  if (!position) {
    console.error("No collateral + debt found for this user (or RPC error). Try bot/getPosition.ts first.");
    process.exit(1);
  }
  logPosition(args.user, position);

  const { error, shortfall } = await executor.accountLiquidity(args.user);
  console.log(`\nComptroller: error=${error}, shortfall=$${ethers.formatUnits(shortfall, 18)}`);
  if (error !== 0n || shortfall <= 0n) {
    console.log("Position is healthy (shortfall == 0) — not liquidatable.");
    return;
  }

  const health = await executor.healthFactor(args.user);
  if (health === null) process.exit(1);
  console.log(`Collateral/debt ratio (display): ${ethers.formatUnits(health, 18)}`);

  const prices = await executor.getPrices([...position.collateral, ...position.debt]);

  let collateralEntry = findEntry(position.collateral, args.collateralAsset);
  let debtEntry = findEntry(position.debt, args.debtAsset);
  if (!collateralEntry || !debtEntry) {
    if (args.collateralAsset !== undefined || args.debtAsset !== undefined) {
      console.error(`Could not find the requested asset(s) in this user's position.`);
      process.exit(1);
    }
    // Auto-pick: the largest positions by USD value.
    // Note: getPrices keys the map by mToken address, not underlying asset.
    collateralEntry = position.collateral[0]!;
    debtEntry = position.debt[0]!;
    for (const c of position.collateral) {
      const p = prices[c.mToken] ?? 0n;
      const cp = prices[collateralEntry.mToken] ?? 0n;
      if ((c.amount * p) / 10n ** BigInt(c.decimals) > (collateralEntry.amount * cp) / 10n ** BigInt(collateralEntry.decimals)) {
        collateralEntry = c;
      }
    }
    for (const d of position.debt) {
      const p = prices[d.mToken] ?? 0n;
      const dp = prices[debtEntry.mToken] ?? 0n;
      if ((d.amount * p) / 10n ** BigInt(d.decimals) > (debtEntry.amount * dp) / 10n ** BigInt(debtEntry.decimals)) {
        debtEntry = d;
      }
    }
  }

  const opp = await executor.evaluatePair(args.user, health, collateralEntry, debtEntry, prices, {
    ...(args.debtToCover !== undefined ? { debtToCover: args.debtToCover } : {}),
  });
  if (!opp) {
    console.log(
      "Not executable: no Aerodrome route for this pair, or estimated profit is below MIN_PROFIT_USD " +
        `($${executor.config.minProfitUsd}).`
    );
    return;
  }

  console.log(`\n=== Opportunity ===`);
  console.log(describeOpportunity(opp));
  console.log(
    `  liquidationIncentive: +${opp.liquidationBonusNetBps} bps, protocol share: ${opp.protocolFeeAmount} ` +
      `${opp.collateralSymbol}, flash amount (debtToCover): ${opp.debtToCover}`
  );
  console.log(`  mTokenDebt: ${opp.mTokenDebt}, mTokenCollateral: ${opp.mTokenCollateral}`);
  console.log(`  route: ${opp.routes.map((r) => `${r.from}->${r.to}${r.stable ? " (stable)" : ""}`).join(" -> ")}`);
  console.log(`  amountOutMin (slippage-protected): ${opp.amountOutMin}`);
  console.log(`  minProfit guard: ${opp.minProfit}`);
  console.log("\n  calls:");
  for (const call of opp.calls) {
    console.log(`    target=${call.target} value=${call.value} data=${call.data.slice(0, 66)}...`);
  }

  if (!args.execute) {
    console.log("\nDry run (no --execute). Re-run with --execute to submit (requires LIVE_EXECUTION=true in .env).");
    return;
  }
  if (!executor.config.liveExecution) {
    console.error("\n--execute given but LIVE_EXECUTION is not 'true' in .env — nothing was sent.");
    process.exit(1);
  }

  console.log("\nSubmitting...");
  const result = await executor.execute(opp);
  console.log(`Result: ${result.status}${result.message ? ` — ${result.message}` : ""}${result.txHash ? ` (${result.txHash})` : ""}`);
  if (result.status !== "confirmed" && result.status !== "submitted") {
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
