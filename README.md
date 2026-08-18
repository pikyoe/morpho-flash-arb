# Morpho Flash-Loan Arbitrage — Base

A production-structured Foundry project for flash-loan arbitrage on **Base**,
using **Morpho Blue's** fee-free flash loans. The included strategy is
**DEX vs. lending-protocol arbitrage**: liquidate undercollateralized
positions on **Moonwell** (Base's Compound V2 fork, capturing the ~7%
liquidator share of the 10% liquidation incentive) and sell the seized
collateral on **Aerodrome** (Base's native DEX) or **Uniswap V3**, all
atomically inside one flash-borrowed transaction.

> **This is a starting point, not a plug-and-play money printer.** Flash-loan
> arbitrage is highly competitive (MEV searchers, other bots) and mistakes
> with real funds are irreversible. Read [Risks & limitations](#risks--limitations)
> before deploying with real money.
>
> **SECURITY ENHANCED**: This version includes comprehensive security hardening
> including role-based access control, pausable functionality, target whitelisting,
> and enhanced input validation. See [SECURITY.md](SECURITY.md) for details.

## How it works

```
                      ┌─────────────────────────────────────────┐
                      │           FlashLoanArbitrage.sol          │
                      └─────────────────────────────────────────┘
1. owner calls executeArbitrage(asset, amount, calls[], minProfit)
   (asset = the DEBT token, e.g. USDC)
2. contract calls Morpho.flashLoan(asset, amount, data)
3. Morpho sends `amount` of `asset` to the contract, then calls back:
     onMorphoFlashLoan(assets, data)
4. contract executes `calls[]` in order, e.g. (Moonwell route):
     a) USDC.approve(mUSDC, repayAmount)                    # allow mUSDC to pull debt
     b) mUSDC.liquidateBorrow(borrower, repayAmount, mWETH) # repay debt, seize WETH
        -> receives discounted WETH collateral (underlying, not mTokens)
     c) WETH.approve(AerodromeRouter, seized)
     d) AerodromeRouter.swapExactTokensForTokens(seized, minOut, ..., self, deadline)
        -> converts collateral back into `asset` (USDC)
5. contract checks balance(asset) >= amount + minProfit, else reverts
   (which also reverts the flash loan and the liquidation — fully atomic,
   you can never end up "stuck" mid-arbitrage)
6. contract approves Morpho for `amount` (repayment) and sends the
   remaining profit to the owner
```

Because step 5 is enforced *before* any state changes are kept, a failed or
unprofitable route costs you nothing but gas — the whole transaction reverts.

## Security Features

This contract includes comprehensive security hardening to protect against common attack vectors:

### Role-Based Access Control (RBAC)
- **ADMIN_ROLE**: Full administrative access (withdraw, manage roles, whitelist)
- **OPERATOR_ROLE**: Can execute arbitrage operations only
- **PAUSER_ROLE**: Can pause/unpause the contract for emergency response
- **DEFAULT_ADMIN_ROLE**: Can grant/revoke all roles

### Pausable Functionality
- Contract can be paused by anyone with PAUSER_ROLE
- All arbitrage operations are blocked when paused
- Only ADMIN_ROLE can unpause the contract
- Provides emergency response capability

### Target Contract Whitelisting
- Only whitelisted contracts can be called in arbitrage routes
- Prevents calls to malicious contracts
- Admin can add/remove targets from whitelist
- Default whitelist includes the Moonwell mToken markets, Aerodrome,
  Uniswap, WETH, USDC and the other collateral tokens (see
  `script/Deploy.s.sol`)

### Enhanced Input Validation
- Zero address checks for all address parameters
- Minimum flash loan size to prevent dust attacks
- Maximum calls limit (20) to prevent gas griefing
- Minimum profit requirement to prevent useless transactions
- Call target whitelist validation

### Emergency Functions
- `withdrawToken()`: Rescue stuck ERC20 tokens (ADMIN only)
- `withdrawETH()`: Rescue stuck ETH (ADMIN only)
- `pause()`/`unpause()`: Emergency stop/resume (PAUSER/ADMIN)
- Role management functions for quick response to compromises

For detailed security documentation, see [SECURITY.md](SECURITY.md).

## Project structure

```
src/
  FlashLoanArbitrage.sol       # main contract: flash loan + generic call executor
                               # ENHANCED: RBAC, pausable, whitelisting, validation
  BaseAddresses.sol            # verified Base mainnet contract addresses
  interfaces/
    IMorpho.sol                 # Morpho Blue flashLoan + callback interface
    IAerodromeRouter.sol        # Aerodrome (Base native DEX) router
    IUniswapV3Router.sol        # Uniswap V3 SwapRouter02 (alternate DEX leg)
    IMoonwellMarket.sol         # Moonwell mToken: liquidateBorrow/redeem/exchangeRate
    IMoonwellComptroller.sol    # Moonwell Comptroller: health + liquidation params
    IMoonwellOevWrapper.sol     # Moonwell ChainlinkOEVWrapper: updatePriceEarlyAndLiquidate
  libraries/
    CallBuilder.sol             # helpers for encoding Call[] routes
  mocks/
    MockPriceFeed.sol           # mock price feed for testing
script/
  Deploy.s.sol                  # forge script to deploy to Base with security setup
  SetupRoles.s.sol              # script to configure role-based access control
  SetupLiquidatablePosition.s.sol # script to create test liquidatable positions
test/
  FlashLoanArbitrage.t.sol      # fork tests against real Morpho/Base contracts
  CallBuilder.t.sol             # pure unit tests for calldata encoding
  SecurityHardening.t.sol       # comprehensive security tests
bot/
  executor.ts                   # SHARED MAINNET EXECUTION ENGINE: exact Moonwell
                                 # (Compound V2) liquidation math, route quoting,
                                 # simulation, private submission + retries.
                                 # watch.ts, ml-enhanced-watch.ts and
                                 # checkPosition.ts all execute through this file.
  checkPosition.ts              # manual CLI: checks a position, prices the DEX
                                 # exit, optionally submits (same engine as the bot)
  watch.ts                      # automated bot: Borrow-event discovery + subgraph
                                 # sweep -> executor
  ml-enhanced-watch.ts          # watch.ts + optional ML gate (off by default)
  scanBorrowers.ts              # one-shot scanner for liquidatable Moonwell positions
  getPosition.ts                # helper to get position details
  addresses.ts / abi.ts         # shared constants for the bot
  types.ts                      # TypeScript type definitions
SECURITY.md                     # comprehensive security documentation
.env.example
foundry.toml
```

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`)
- Node.js 18+ (for the off-chain bot)
- A Base RPC URL (e.g. `https://mainnet.base.org`, or a provider like Alchemy/Infura)
- A funded wallet (for gas — the flash loan itself needs no upfront capital)

## Setup

```bash
git clone <this-repo>
cd morpho-flash-arb
forge install                     # pulls forge-std + OpenZeppelin (already vendored here)
cp .env.EXAMPLE .env              # fill in PRIVATE_KEY, BASE_RPC_URL, etc.

cd bot && npm install && cd ..
```

## Build & test

```bash
forge build

# Fork tests hit real Morpho Blue + WETH on Base — set BASE_RPC_URL first.
forge test --fork-url $BASE_RPC_URL -vvv

# Pure unit tests (calldata encoding) need no network:
forge test --match-contract CallBuilderTest -vvv
```

The fork tests don't run a real DEX swap (that requires live liquidity and is
exactly the part your off-chain bot computes) — instead they simulate "the
route was profitable" by dealing extra WETH to the contract before the
callback runs, then assert the contract correctly repays Morpho and forwards
only the *profit* portion to the owner. This isolates and verifies the
on-chain mechanics (flash loan, call execution, profit check, repayment)
independent of any specific market conditions.

## Deploy

### 1. Deploy the Contract

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url base \
  --broadcast \
  --verify \
  -vvvv
```

This will:
- Deploy the FlashLoanArbitrage contract with all security features
- Set up the initial target whitelist (Moonwell mTokens, Aerodrome, Uniswap,
  WETH, USDC, cbETH, wstETH, cbBTC — see `script/Deploy.s.sol`)
- Grant all roles to the deployer initially

### 2. Configure Role-Based Access Control (Recommended)

For production deployment, separate the roles for better security:

```bash
# Set up environment variables
export OPERATOR_ADDRESS=0x...  # Your bot address
export PAUSER_ADDRESS=0x...    # Your emergency response address
export ARBITRAGE_CONTRACT_ADDRESS=0x...  # From deployment output

# Run the role setup script
forge script script/SetupRoles.s.sol:SetupRoles \
  --rpc-url base \
  --broadcast \
  -vvvv
```

This will:
- Grant OPERATOR_ROLE to your bot address (can execute arbitrage)
- Grant PAUSER_ROLE to your emergency address (can pause in emergencies)
- Keep ADMIN_ROLE with the deployer (can manage roles and withdraw funds)

### 3. Update Bot Configuration

Copy the deployed address into `bot/.env`:

```bash
echo "ARBITRAGE_CONTRACT_ADDRESS=0x..." >> bot/.env
```

**IMPORTANT**: Ensure the bot uses a wallet with OPERATOR_ROLE, not ADMIN_ROLE.

## Running the off-chain bot

The bot discovers candidates two ways (no more hand-feeding addresses):

1. **Event discovery (hot)**: every cycle it reads `Borrow` events from every
   scanned Moonwell mToken in the last `EVENT_LOOKBACK_BLOCKS` blocks and
   checks those users' shortfall immediately (`comptroller.getAccountLiquidity`).
   This catches newly-borrowed positions the moment the market moves against them.
2. **Subgraph sweep (cold)**: every `CANDIDATE_REFRESH_MIN` minutes it pulls a
   borrower list from a Moonwell subgraph (set `MOONWELL_SUBGRAPH_URL`, e.g. a
   Goldsky deployment) and shortfall-checks it.

> **The bot is already ported.** `bot/executor.ts` (the shared engine),
> `bot/watch.ts`, `bot/ml-enhanced-watch.ts`, `bot/checkPosition.ts`,
> `bot/scanBorrowers.ts` and `bot/getPosition.ts` all target Moonwell: the
> exact seize math from the table above (close factor, incentive, protocol
> share, `exchangeRateStored`), candidate discovery from mToken `Borrow`
> events, and health checks via `comptroller.getAccountLiquidity()`
> (`shortfall > 0`). The on-chain contract itself needs **no changes** — only
> the `Call[]` route and the whitelist (see below).

Every liquidatable candidate is then sized and executed through
`bot/executor.ts`, which:

- replicates the **exact Moonwell (Compound V2) liquidation math** on-chain
  (close factor and liquidation incentive + protocol seize share read from the
  Comptroller, real mToken collateral balance cap) so the flash loan amount
  always equals what Moonwell actually pulls — never more;
- quotes the Aerodrome exit with **multi-hop routing** (direct pool, then via
  WETH/USDC bridge) and enforces **slippage** (`SLIPPAGE_BPS`) plus an
  on-chain `minProfit` guard that is always > 0;
- **simulates the whole transaction against pending state** before
  broadcasting, so an already-liquidated position is never sent (no wasted
  gas, no telegraphing the tx);
- submits **privately first** (bloXroute `blxr_tx` on Base when
  `BLOXROUTE_AUTH_HEADER` is set, plus any `PRIVATE_RPC_URLS`), falls back
  to the public mempool, and retries with replace-by-fee until
  `TX_TIMEOUT_MS`.

```bash
cd bot
npx tsx watch.ts                # dry-run bot (default)
LIVE_EXECUTION=true npx tsx watch.ts   # sends real transactions
```

Manual one-shot check of a specific position:

```bash
npx tsx checkPosition.ts --user 0xBorrowerAddress \
  --debtAsset USDC --collateralAsset WETH \
  [--debtToCover 1000000000]

# once you're happy with the dry-run output:
LIVE_EXECUTION=true npx tsx checkPosition.ts ... --execute
```

`checkPosition.ts` prints the shortfall, the exact seized-collateral and flash
amounts, the live Aerodrome quote (with the chosen route), the
slippage-protected minimum, and the built `Call[]` calldata.

> `--bonusBps` is no longer needed: the liquidation incentive is read on-chain
> from the Moonwell Comptroller. `--debtToCover` is optional; it defaults to
> the maximum the close factor allows.

### Live preview dashboard

`npm run preview` (inside `bot/`) starts a small web dashboard on port
`3000` that runs the ML-enhanced watch bot as a child process and streams
its live logs, plus a checklist of which env vars are set. The bot always
runs in dry-run mode there unless `LIVE_EXECUTION=true` is set.

## Moonwell liquidation (primary strategy)

Moonwell on Base is a **Compound V2 fork**: every market (`mUSDC`, `mWETH`, …)
is its own mToken contract and liquidations happen through
`mToken.liquidateBorrow(borrower, repayAmount, mTokenCollateral)`, called on
the **debt** market. Unlike Aave's `Pool.liquidationCall`, the mToken *pulls*
the repaid debt from the caller (so the arbitrage contract must `approve` the
debt mToken first) and the seized collateral arrives as the **underlying
token** (e.g. WETH), ready to sell on a DEX — no `receiveAToken` flag, no
wrapped-position dance.

### Route (standard path — USDC debt, WETH collateral)

```solidity
FlashLoanArbitrage.Call[] memory calls = new FlashLoanArbitrage.Call[](4);
calls[0] = CallBuilder.moonwellLiquidationLeg(USDC, mUSDC, borrower, repayAmount, mWETH)[0]; // approve debt
calls[1] = CallBuilder.moonwellLiquidationLeg(USDC, mUSDC, borrower, repayAmount, mWETH)[1]; // liquidateBorrow
calls[2] = CallBuilder.approve(WETH, AERODROME_ROUTER, seizedWETH);
calls[3] = CallBuilder.aerodromeSwap(AERODROME_ROUTER, seizedWETH, minOut, WETH, USDC, false, AERODROME_POOL_FACTORY, address(this), deadline);
```

The flash-loan repayment needs no call: the contract force-approves Morpho and
repays inside `onMorphoFlashLoan`. (Simpler: `moonwellLiquidationLeg(...)`
already returns the approve+liquidate pair — use it as the first two entries.)

### The math the bot needs

| Parameter | Value on Moonwell Base | On-chain source |
| --- | --- | --- |
| Close factor (max repayable share) | `0.5e18` (50%) | `comptroller.closeFactorMantissa()` |
| Liquidation incentive | `1.10e18` (10% bonus) | `comptroller.liquidationIncentiveMantissa()` |
| Liquidator keeps | ~7% of gross (10% − 3% protocol share) | `mTokenCollateral.protocolSeizeShareMantissa()` (`0.03e18`, verified on Base — the Comptroller does not expose it) |
| Position health | `shortfall > 0` ⇒ liquidatable | `comptroller.getAccountLiquidity(user)` → `(error, liquidity, shortfall)` |
| Borrow balance / exchange rate | 18-dec mantissas | `mToken.borrowBalanceStored(user)`, `mToken.exchangeRateStored()` |

`CallBuilder.estimateMoonwellSeizedUnderlying(...)` mirrors the on-chain
`Comptroller.liquidateCalculateSeizeTokens()` math (gross seize, then minus the
protocol share) so the bot can price the DEX exit before sending anything.

### OEV path (competitive mainnet liquidations)

Moonwell Base now routes oracles through Chainlink OEV: a fresh Chainlink
price is held for ~10s, during which only the per-collateral
`ChainlinkOEVWrapper.updatePriceEarlyAndLiquidate(borrower, repayAmount, mTokenCollateral, mTokenLoan)`
can use it. This is the only realistic way to win contested liquidations, but
it changes the payout:

- liquidator's share arrives as **mTokens** (not underlying) → the route must
  add a `mToken.redeem(amount)` call before the DEX swap;
- the wrapper splits the 10% bonus `liquidatorFeeBps` (currently 4000 = 40%)
  between the liquidator and the protocol — you keep your full repayment plus
  `profit × 40%`, so per-position profit is *lower* than the standard path;
- one wrapper per collateral feed (WETH wrapper on Base:
  `0xeb083d234ec636A10325ea42bCbbE09Aa56d1547` — see
  `BaseAddresses.MOONWELL_OEV_WRAPPER_WETH`).

`CallBuilder.moonwellOevLiquidationLeg(...)` builds the approve + wrapper call;
`CallBuilder.moonwellRedeem(...)` builds the redeem call. A full OEV route is:
`approve(USDC → wrapper)` → `wrapper.updatePriceEarlyAndLiquidate(...)` →
`mWETH.redeem(mTokenBalance)` → `approve(WETH → router)` → `aerodromeSwap(...)`.

### Whitelisting for the Moonwell route

Call targets the ADMIN must whitelist for the route above (via
`addTargetToWhitelist`/`batchAddTargetsToWhitelist`):

| Target | Why |
| --- | --- |
| `mUSDC` (debt mToken) | `liquidateBorrow` is called on it |
| `USDC` | `approve` call (repay amount) |
| `WETH` | `approve` call (DEX sell) |
| Aerodrome router | the swap |
| OEV wrapper (`0xeb08…1547`) | only for the OEV path |
| `mWETH` | only for the OEV path (`redeem` call) |

> The collateral mToken (`mWETH`) does **not** need whitelisting for the
> standard path — the seize happens *inside* `liquidateBorrow`; you never call
> the collateral mToken directly.

All Moonwell addresses (Comptroller, mTokens, OEV wrapper, Chainlink oracle)
live in `src/BaseAddresses.sol` under the `MOONWELL_*` constants, verified
against the official Moonwell docs (Aug 2026).

## Adapting the strategy

The contract itself (`FlashLoanArbitrage.sol`) is deliberately generic — it
just executes whatever `Call[]` you pass it, then enforces a minimum profit.
That means you can repurpose it for other routes without touching Solidity:

- **DEX vs. DEX price arbitrage**: swap on Aerodrome, swap back on Uniswap V3
  (or vice versa) — see `CallBuilder.aerodromeSwap` and adapt for
  `IUniswapV3Router.exactInputSingle`.
- **Other Compound forks or lending protocols**: add a new interface +
  `CallBuilder` helper following the same pattern as `IMoonwellMarket.sol`
  (e.g. Morpho Blue, Compound V3, or re-adding Aave V3).
- **Multi-hop routes**: just add more entries to the `Call[]` array — they
  execute in order.

## Mainnet readiness checklist

This scaffold is not audited and liquidations on Base are heavily contested.
Before deploying with real funds:

- [ ] **Run the full fork test suite** (`forge test --fork-url $BASE_RPC_URL -vvv`)
      and the `CallBuilderTest` unit tests; review `SECURITY.md`.
- [ ] **Separate roles**: deploy with a burner admin key, then grant
      `OPERATOR_ROLE` to the bot's hot wallet and `PAUSER_ROLE` to an emergency
      address via `script/SetupRoles.s.sol`. Admin holds all roles initially.
- [ ] **Whitelist every collateral asset** you intend to liquidate
      (`addTargetToWhitelist`) — the route approves the collateral token before
      the DEX swap, so an un-whitelisted token makes the whole tx revert.
      For Moonwell also whitelist the debt mToken (and the OEV wrapper +
      collateral mToken if you use the OEV path) — see the whitelist table in
      the [Moonwell section](#moonwell-liquidation-primary-strategy).
- [ ] **Set `GRAPH_API_KEY`**, `BASE_RPC_URL`, `ARBITRAGE_CONTRACT_ADDRESS` and
      `MIN_PROFIT_USD`; keep `LIVE_EXECUTION=false` and `ML_ENABLED=false`
      (the ML layer currently uses mock models) until dry-run looks right.
- [ ] **Wire the private submission path** (`BLOXROUTE_AUTH_HEADER`) — public-
      mempool liquidations are routinely lost to professional searchers. Without
      it the bot still works, just with a higher front-run risk.
- [ ] **Keep the operator key cold-ish**: an operator can craft routes that move
      any *standing* whitelisted-token balance (e.g. approve+drain WETH), so the
      contract should hold ~0 tokens outside flash-loan callbacks.
- [ ] **Fund the operator wallet** with enough ETH for gas (`MIN_WALLET_ETH_BALANCE`,
      default 0.005 ETH) — the flash loan needs no upfront capital, but the gas
      for the transaction does.

## Environment variables (bot)

| Variable | Default | Purpose |
| --- | --- | --- |
| `BASE_RPC_URL` | `https://mainnet.base.org` | Base mainnet RPC |
| `MOONWELL_SUBGRAPH_URL` | — | Moonwell subgraph endpoint (e.g. Goldsky) for the cold borrower sweep |
| `LIVE_EXECUTION` | `false` | `true` sends real transactions; otherwise dry-run |
| `PRIVATE_KEY` | — | Operator wallet (needs OPERATOR_ROLE on the contract) — required when `LIVE_EXECUTION=true` |
| `ARBITRAGE_CONTRACT_ADDRESS` | — | Deployed FlashLoanArbitrage; needed to build/execute real routes |
| `MIN_PROFIT_USD` | `1` | Minimum estimated profit before executing |
| `MIN_COLLATERAL_USD` | `100` | Skip candidates with less shortfall (USD) |
| `MAX_GAS_PRICE_GWEI` | `5` | Gas price cap; also caps RBF bumps |
| `MIN_WALLET_ETH_BALANCE` | `0.005` | Pause live execution below this ETH balance |
| `MAX_CONSECUTIVE_FAILURES` | `3` | Circuit breaker threshold |
| `SLIPPAGE_BPS` | `100` | DEX slippage tolerance (1%) |
| `SIMULATE_BEFORE_SEND` | `true` | `eth_call` the full tx against pending state before broadcasting |
| `GAS_LIMIT_MULTIPLIER_PCT` | `130` | Buffer on top of the estimated gas limit |
| `TX_TIMEOUT_MS` | `90000` | Max time to wait for confirmation (with resend + RBF) |
| `MAX_TX_RETRIES` | `2` | Resends before the replace-by-fee bump |
| `PRIORITY_FEE_GWEI` | `0.01` | Priority fee when the RPC reports none |
| `BLOXROUTE_AUTH_HEADER` | — | bloXroute auth header → private Base submission via `blxr_tx` |
| `PRIVATE_RPC_URLS` | — | Comma-separated extra private JSON-RPC endpoints (`eth_sendRawTransaction`) |
| `POLL_INTERVAL_SEC` | `20` | Bot cycle interval |
| `CANDIDATE_REFRESH_MIN` | `5` | Subgraph (cold) sweep interval |
| `SCAN_LIMIT` | `300` | Max subgraph candidates per sweep |
| `EVENT_LOOKBACK_BLOCKS` | `300` | Blocks of `Borrow` events scanned every cycle (≈10 min on Base) |
| `EVENT_DISCOVERY` / `SUBGRAPH_DISCOVERY` | `true` | Toggle each discovery source (mToken Borrow events / subgraph sweep) |
| `ML_ENABLED` | `false` | Opt-in ML gate (models are mock — keep off for mainnet) |

## Risks & limitations

- **Not audited.** Do not deploy with meaningful funds without a professional
  audit and extensive fork testing against realistic scenarios.
- **MEV competition.** Profitable liquidations and price discrepancies are
  contested by many bots and searchers; expect most naive attempts to lose
  the race (or get front-run/sandwiched) unless you use a private
  mempool/builder relationship.
- **Price/oracle risk.** The bot's profit estimate uses a live DEX quote at
  call time, but prices can move between quoting and execution — the
  on-chain `minProfit` check is your real safety net, not the off-chain
  estimate.
- **Sizing races.** The bot sizes the liquidation with the exact on-chain
  math and re-simulates before sending, but between quote and inclusion the
  price, the borrower's debt, or another liquidator can move the position.
  The on-chain `minProfit` guard plus the atomic flash loan mean a stale
  opportunity reverts harmlessly (gas only) instead of losing funds.
- **Contract addresses change.** Protocols occasionally redeploy or migrate.
  Addresses in `src/BaseAddresses.sol` and `bot/addresses.ts` were verified
  against official docs/explorers as of Aug 2026 — re-verify before
  deploying, especially after long periods of inactivity.
- **Key security.** This contract uses role-based access control. The ADMIN key
  can withdraw funds and manage roles — treat it like it controls a hot wallet,
  because it does. Use hardware wallets for ADMIN and PAUSER roles.
- **Whitelist dependency.** The contract can only call whitelisted targets.
  If you need to interact with a new protocol, an admin must update the whitelist
  first. This is a security feature but adds operational overhead.
- **Emergency procedures.** The contract can be paused by anyone with PAUSER_ROLE.
  Ensure you have a documented incident response plan and test emergency procedures
  regularly.

## License

MIT
