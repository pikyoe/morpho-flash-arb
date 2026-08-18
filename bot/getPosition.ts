#!/usr/bin/env node
/**
 * Given a user address, lists their per-market collateral and debt across every
 * scanned Moonwell market on Base. Collateral is converted from mToken balances
 * to underlying units via each market's exchange rate.
 *
 * Usage:
 *   npx tsx getPosition.ts --user 0xBorrowerAddress
 */
import "dotenv/config";
import { ethers } from "ethers";
import { ADDRESSES, MARKETS } from "./addresses.js";
import { ERC20_ABI, MOONWELL_COMPTROLLER_ABI, MOONWELL_MARKET_ABI } from "./abi.js";
import type { Address, PositionEntry } from "./types.js";

interface Args {
  user: Address;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let user: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--user") user = args[++i];
  }
  if (!user || !ethers.isAddress(user)) {
    console.error("Usage: npx tsx getPosition.ts --user <address>");
    process.exit(1);
  }
  return { user };
}

async function main(): Promise<void> {
  const args = parseArgs();

  const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const provider = new ethers.JsonRpcProvider(rpcUrl, 8453, {
    staticNetwork: true,
    batchMaxCount: 1,
  });

  const comptroller = new ethers.Contract(
    ADDRESSES.MOONWELL_COMPTROLLER as string,
    MOONWELL_COMPTROLLER_ABI,
    provider
  );

  const { error, liquidity, shortfall } = await comptroller.getAccountLiquidity!(args.user);

  console.log(`Position summary for ${args.user}`);
  console.log(`Comptroller: error=${error} liquidity=$${ethers.formatUnits(liquidity as bigint, 18)} ` +
    `shortfall=$${ethers.formatUnits(shortfall as bigint, 18)}`);
  console.log(shortfall > 0n ? "  -> LIQUIDATABLE\n" : "  -> healthy\n");
  console.log(`Scanning ${MARKETS.length} Moonwell markets for non-zero balances...\n`);

  const CONCURRENCY = 8;
  const collateral: PositionEntry[] = [];
  const debt: PositionEntry[] = [];

  for (let i = 0; i < MARKETS.length; i += CONCURRENCY) {
    const batch = MARKETS.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (m) => {
        const market = new ethers.Contract(m.mToken, MOONWELL_MARKET_ABI, provider);
        const underlying = new ethers.Contract(m.asset, ERC20_ABI, provider);

        const [mTokenBal, borrowBal, symbol, decimals, exchangeRate] = await Promise.all([
          market.balanceOf!(args.user) as Promise<bigint>,
          market.borrowBalanceStored!(args.user) as Promise<bigint>,
          underlying.symbol!() as Promise<string>,
          underlying.decimals!() as Promise<number>,
          market.exchangeRateStored!() as Promise<bigint>,
        ]);

        const info = {
          mToken: m.mToken,
          asset: m.asset,
          symbol,
          decimals: Number(decimals),
          exchangeRate,
        };

        // underlying = mTokens * exchangeRate / 1e18
        const collateralUnderlying = (mTokenBal * exchangeRate) / 10n ** 18n;
        if (collateralUnderlying > 0n) collateral.push({ ...info, amount: collateralUnderlying });
        if (borrowBal > 0n) debt.push({ ...info, amount: borrowBal });
      })
    );
  }

  console.log("=== Collateral supplied (underlying units) ===");
  if (collateral.length === 0) console.log("(none)");
  for (const c of collateral) {
    console.log(`${c.symbol.padEnd(8)} ${ethers.formatUnits(c.amount, c.decimals)}  (mToken: ${c.mToken})`);
  }

  console.log("\n=== Debt borrowed ===");
  if (debt.length === 0) console.log("(none)");
  for (const d of debt) {
    console.log(`${d.symbol.padEnd(8)} ${ethers.formatUnits(d.amount, d.decimals)}  (mToken: ${d.mToken})`);
  }

  if (collateral.length > 0 && debt.length > 0) {
    const c = collateral[0]!;
    const d = debt[0]!;
    const suggestedDebtToCover = d.amount / 2n;
    console.log("\n=== Suggested checkPosition.ts command ===");
    console.log(
      `npx tsx checkPosition.ts --user ${args.user} --debtAsset ${d.symbol} ` +
        `--collateralAsset ${c.symbol} --debtToCover ${suggestedDebtToCover.toString()}`
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
