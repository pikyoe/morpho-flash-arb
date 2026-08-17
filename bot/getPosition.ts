#!/usr/bin/env node
/**
 * Given a user address, lists their actual per-asset collateral (aToken)
 * and debt (variableDebtToken) balances across every Aave V3 Base reserve.
 *
 * Usage:
 *   node --experimental-strip-types getPosition.ts --user 0xBorrowerAddress
 *   (or: npx tsx getPosition.ts --user 0xBorrowerAddress)
 */
import "dotenv/config";
import { ethers } from "ethers";
import { ADDRESSES } from "./addresses.js";
import { ERC20_ABI, AAVE_POOL_RESERVES_ABI } from "./abi.js";
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
    console.error("Usage: node getPosition.ts --user <address>");
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

  const pool = new ethers.Contract(
    ADDRESSES.AAVE_V3_POOL as string,
    [...AAVE_POOL_RESERVES_ABI, "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)"],
    provider
  );

  const accountData = await pool.getUserAccountData!(args.user);
  const reserves: Address[] = await pool.getReservesList!();

  console.log(`Position summary for ${args.user}`);
  console.log(`Health factor: ${ethers.formatUnits(accountData.healthFactor as bigint, 18)}`);
  console.log(
    `Total collateral: $${ethers.formatUnits(accountData.totalCollateralBase as bigint, 8)} | ` +
      `Total debt: $${ethers.formatUnits(accountData.totalDebtBase as bigint, 8)}\n`
  );
  console.log(`Scanning ${reserves.length} reserves for non-zero balances...\n`);

  const CONCURRENCY = 8;
  const collateral: PositionEntry[] = [];
  const debt: PositionEntry[] = [];

  for (let i = 0; i < reserves.length; i += CONCURRENCY) {
    const batch = reserves.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (asset) => {
        const reserveData = await pool.getReserveData!(asset);
        const aTokenAddress = reserveData.aTokenAddress as Address;
        const variableDebtTokenAddress = reserveData.variableDebtTokenAddress as Address;

        const aToken = new ethers.Contract(aTokenAddress, ERC20_ABI, provider);
        const debtToken = new ethers.Contract(variableDebtTokenAddress, ERC20_ABI, provider);
        const underlying = new ethers.Contract(asset, ERC20_ABI, provider);

        const [aBal, debtBal, symbol, decimals] = await Promise.all([
          aToken.balanceOf!(args.user) as Promise<bigint>,
          debtToken.balanceOf!(args.user) as Promise<bigint>,
          underlying.symbol!() as Promise<string>,
          underlying.decimals!() as Promise<number>,
        ]);

        const info = { asset, symbol, decimals: Number(decimals), aTokenAddress, variableDebtTokenAddress };

        if (aBal > 0n) collateral.push({ ...info, amount: aBal });
        if (debtBal > 0n) debt.push({ ...info, amount: debtBal });
      })
    );
  }

  console.log("=== Collateral supplied ===");
  if (collateral.length === 0) console.log("(none)");
  for (const c of collateral) {
    console.log(`${c.symbol.padEnd(8)} ${ethers.formatUnits(c.amount, c.decimals)}  (asset: ${c.asset})`);
  }

  console.log("\n=== Debt borrowed (variable rate) ===");
  if (debt.length === 0) console.log("(none)");
  for (const d of debt) {
    console.log(`${d.symbol.padEnd(8)} ${ethers.formatUnits(d.amount, d.decimals)}  (asset: ${d.asset})`);
  }

  if (collateral.length > 0 && debt.length > 0) {
    const c = collateral[0]!;
    const d = debt[0]!;
    const suggestedDebtToCover = d.amount / 2n;
    console.log("\n=== Suggested checkPosition.ts command ===");
    console.log(
      `node checkPosition.ts --user ${args.user} --debtAsset ${d.symbol} ` +
        `--collateralAsset ${c.symbol} --debtToCover ${suggestedDebtToCover.toString()} --bonusBps 500`
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
