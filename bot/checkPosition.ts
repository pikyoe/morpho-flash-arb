#!/usr/bin/env node
/**
 * Off-chain half of the arbitrage: checks whether a given Aave V3 borrower on
 * Base is liquidatable, prices the DEX-side exit on Aerodrome, and (optionally)
 * submits the resulting FlashLoanArbitrage.executeArbitrage transaction.
 *
 * Usage:
 *   npx tsx checkPosition.ts \
 *     --user 0xBorrowerAddress \
 *     --debtAsset USDC \
 *     --collateralAsset WETH \
 *     --debtToCover 1000000000 \
 *     [--bonusBps 500] [--execute]
 */
import "dotenv/config";
import { ethers } from "ethers";
import { ADDRESSES } from "./addresses.js";
import { AAVE_V3_POOL_ABI, AERODROME_ROUTER_ABI, ERC20_ABI, FLASH_LOAN_ARBITRAGE_ABI, AAVE_ORACLE_ABI } from "./abi.js";
import type { Address, ArbitrageCall } from "./types.js";

const TOKENS: Record<string, Address> = {
  WETH: ADDRESSES.WETH!,
  USDC: ADDRESSES.USDC!,
  CBETH: ADDRESSES.CBETH!,
};

function resolveToken(symbolOrAddress: string): Address {
  if (ethers.isAddress(symbolOrAddress)) return symbolOrAddress;
  // Cast needed: ethers' `isAddress` type predicate is `value is string`, and
  // since our param is already typed `string`, TS narrows the false-branch
  // to `never` (logically "provably a string, so 'not a string' is
  // impossible" — a static-type-only quirk, not a real runtime guarantee).
  const addr = TOKENS[(symbolOrAddress as string).toUpperCase()];
  if (!addr) throw new Error(`Unknown token symbol: ${symbolOrAddress as string}`);
  return addr;
}

interface Args {
  execute: boolean;
  bonusBps: bigint;
  user: Address;
  debtAsset: string;
  collateralAsset: string;
  debtToCover: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = { execute: false, bonusBps: 500n };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--execute") out.execute = true;
    else if (a === "--user") {
      const v = args[++i];
      if (v !== undefined) out.user = v;
    } else if (a === "--debtAsset") {
      const v = args[++i];
      if (v !== undefined) out.debtAsset = v;
    } else if (a === "--collateralAsset") {
      const v = args[++i];
      if (v !== undefined) out.collateralAsset = v;
    } else if (a === "--debtToCover") {
      const v = args[++i];
      if (v !== undefined) out.debtToCover = v;
    } else if (a === "--bonusBps") {
      const v = args[++i];
      if (v !== undefined) out.bonusBps = BigInt(v);
    }
  }
  if (!out.user || !out.debtAsset || !out.collateralAsset || !out.debtToCover) {
    console.error(
      "Usage: node checkPosition.ts --user <addr> --debtAsset <sym|addr> " +
        "--collateralAsset <sym|addr> --debtToCover <amountRaw> [--bonusBps 500] [--execute]"
    );
    process.exit(1);
  }
  return out as Args;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const debtAsset = resolveToken(args.debtAsset);
  const collateralAsset = resolveToken(args.collateralAsset);
  const debtToCover = BigInt(args.debtToCover);

  const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const provider = new ethers.JsonRpcProvider(rpcUrl, 8453, {
    staticNetwork: true,
    batchMaxCount: 1,
  });

  const pool = new ethers.Contract(ADDRESSES.AAVE_V3_POOL!, AAVE_V3_POOL_ABI, provider);
  const oracle = new ethers.Contract(ADDRESSES.AAVE_V3_ORACLE!, AAVE_ORACLE_ABI, provider);
  const router = new ethers.Contract(ADDRESSES.AERODROME_ROUTER!, AERODROME_ROUTER_ABI, provider);
  const debtToken = new ethers.Contract(debtAsset, ERC20_ABI, provider);
  const collateralToken = new ethers.Contract(collateralAsset, ERC20_ABI, provider);

  const [debtSymbol, debtDecimalsRaw, collateralSymbol, collateralDecimalsRaw] = await Promise.all([
    debtToken.symbol!() as Promise<string>,
    debtToken.decimals!() as Promise<number>,
    collateralToken.symbol!() as Promise<string>,
    collateralToken.decimals!() as Promise<number>,
  ]);
  const debtDecimals = Number(debtDecimalsRaw);
  const collateralDecimals = Number(collateralDecimalsRaw);

  // --- Step 1: is this position liquidatable? ---
  const accountData = await pool.getUserAccountData!(args.user);
  const healthFactor = accountData.healthFactor as bigint;
  const ONE = 10n ** 18n;
  console.log(`Health factor for ${args.user}: ${ethers.formatUnits(healthFactor, 18)}`);

  if (healthFactor >= ONE) {
    console.log("Position is healthy — not liquidatable. Nothing to do.");
    return;
  }

  // --- Step 2: estimate seized collateral, using real oracle prices. ---
  const [debtAssetPrice, collateralAssetPrice] = (await Promise.all([
    oracle.getAssetPrice!(debtAsset),
    oracle.getAssetPrice!(collateralAsset),
  ])) as [bigint, bigint];

  if (debtAssetPrice === 0n || collateralAssetPrice === 0n) {
    throw new Error("Oracle returned zero price — check the asset addresses");
  }

  const liquidationBonusBps = 10_000n + args.bonusBps; // e.g. bonusBps=500 -> 10500
  const collateralUnit = 10n ** BigInt(collateralDecimals);
  const debtUnit = 10n ** BigInt(debtDecimals);

  const seizedCollateralEstimate =
    (debtToCover * debtAssetPrice * collateralUnit * liquidationBonusBps) /
    (collateralAssetPrice * debtUnit * 10_000n);

  console.log(`Debt asset price: ${ethers.formatUnits(debtAssetPrice, 8)} USD`);
  console.log(`Collateral asset price: ${ethers.formatUnits(collateralAssetPrice, 8)} USD`);
  console.log(
    `Estimated collateral seized (via oracle prices, bonus=${args.bonusBps}bps): ` +
      `${ethers.formatUnits(seizedCollateralEstimate, collateralDecimals)} ${collateralSymbol}`
  );

  // --- Step 3: quote selling seized collateral on Aerodrome. ---
  const routes = [{ from: collateralAsset, to: debtAsset, stable: false, factory: ADDRESSES.AERODROME_POOL_FACTORY! }];
  const amountsOut = (await router.getAmountsOut!(seizedCollateralEstimate, routes)) as bigint[];
  const dexProceeds = amountsOut[amountsOut.length - 1]!;

  console.log(`Selling ${seizedCollateralEstimate} ${collateralSymbol} on Aerodrome -> ${dexProceeds} ${debtSymbol}`);

  // --- Step 4: profit check ---
  const profit = dexProceeds - debtToCover;
  const minProfit = BigInt(process.env.MIN_PROFIT_WEI || "0");

  console.log(`Estimated profit: ${ethers.formatUnits(profit, debtDecimals)} ${debtSymbol}`);

  if (profit <= minProfit) {
    console.log("Not profitable enough. Skipping.");
    return;
  }

  // --- Build the calldata for FlashLoanArbitrage.executeArbitrage ---
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const poolIface = new ethers.Interface(AAVE_V3_POOL_ABI);
  const erc20Iface = new ethers.Interface(ERC20_ABI);
  const routerIface = new ethers.Interface(AERODROME_ROUTER_ABI);

  const arbAddress = process.env.ARBITRAGE_CONTRACT_ADDRESS;
  if (!arbAddress) throw new Error("Set ARBITRAGE_CONTRACT_ADDRESS in your .env");

  const calls: ArbitrageCall[] = [
    {
      target: ADDRESSES.AAVE_V3_POOL!,
      value: 0n,
      data: poolIface.encodeFunctionData("liquidationCall", [collateralAsset, debtAsset, args.user, debtToCover, false]),
    },
    {
      target: collateralAsset,
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
        arbAddress,
        deadline,
      ]),
    },
  ];

  console.log("\nBuilt route:");
  console.log(JSON.stringify(calls, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2));

  if (!args.execute) {
    console.log("\nDry run only. Re-run with --execute to submit the transaction.");
    return;
  }

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("Set PRIVATE_KEY in your .env to execute");

  const wallet = new ethers.Wallet(privateKey, provider);
  const arb = new ethers.Contract(arbAddress, FLASH_LOAN_ARBITRAGE_ABI, wallet);

  console.log("\nSubmitting executeArbitrage...");
  const tx = await arb.executeArbitrage!(debtAsset, debtToCover, calls, minProfit);
  console.log(`Tx sent: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Confirmed in block ${receipt.blockNumber}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
