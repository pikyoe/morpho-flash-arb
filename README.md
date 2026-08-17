# Morpho Flash-Loan Arbitrage — Base

A production-structured Foundry project for flash-loan arbitrage on **Base**,
using **Morpho Blue's** fee-free flash loans. The included strategy is
**DEX vs. lending-protocol arbitrage**: liquidate undercollateralized
positions on **Aave V3** (capturing the liquidation bonus) and sell the
seized collateral on **Aerodrome** (Base's native DEX) or **Uniswap V3**, all
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
2. contract calls Morpho.flashLoan(asset, amount, data)
3. Morpho sends `amount` of `asset` to the contract, then calls back:
     onMorphoFlashLoan(assets, data)
4. contract executes `calls[]` in order, e.g.:
     a) Aave.liquidationCall(collateral, debtAsset=asset, user, amount, false)
        -> receives discounted collateral
     b) collateral.approve(AerodromeRouter, seized)
     c) AerodromeRouter.swapExactTokensForTokens(seized, minOut, ..., self, deadline)
        -> converts collateral back into `asset`
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
- Default whitelist includes Aave, Aerodrome, Uniswap, WETH, USDC

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
    IAaveV3Pool.sol             # Aave V3 Pool: supply/withdraw/liquidationCall
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
  checkPosition.ts              # off-chain: checks a position, quotes DEX exit,
                                 # builds calldata, optionally submits the tx
  scanBorrowers.ts              # scanner for liquidatable Aave positions
  watch.ts                      # automated polling bot
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
cp .env.example .env              # fill in PRIVATE_KEY, BASE_RPC_URL, etc.

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
- Set up the initial target whitelist (Aave, Aerodrome, Uniswap, WETH, USDC)
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

Finding *which* Aave positions are close to liquidation is out of scope for
this scaffold — in production you'd feed candidate addresses from an indexer
(e.g. a subgraph of Aave Base borrow positions, Dune, or your own
event-log scanner watching `Borrow`/`Supply`/`Withdraw` events and
recomputing health factors). `checkPosition.js` is the "given a candidate,
is it actually profitable right now" check you'd run just before submitting:

```bash
cd bot
node checkPosition.js \
  --user 0xBorrowerAddress \
  --debtAsset USDC \
  --collateralAsset WETH \
  --debtToCover 1000000000 \
  --bonusBps 500

# once you're happy with the dry-run output:
node checkPosition.js ... --execute
```

The script prints the health factor, an estimated seized-collateral amount,
a live Aerodrome quote for selling that collateral back to the debt asset,
and the resulting profit estimate — then builds the exact `Call[]` calldata
`executeArbitrage` needs.

## Adapting the strategy

The contract itself (`FlashLoanArbitrage.sol`) is deliberately generic — it
just executes whatever `Call[]` you pass it, then enforces a minimum profit.
That means you can repurpose it for other routes without touching Solidity:

- **DEX vs. DEX price arbitrage**: swap on Aerodrome, swap back on Uniswap V3
  (or vice versa) — see `CallBuilder.aerodromeSwap` and adapt for
  `IUniswapV3Router.exactInputSingle`.
- **Different lending protocol**: swap `IAaveV3Pool` for a Morpho Blue market,
  Compound V3, or Moonwell (all live on Base) by adding an interface +
  `CallBuilder` helper, following the same pattern as `IAaveV3Pool.sol`.
- **Multi-hop routes**: just add more entries to the `Call[]` array — they
  execute in order.

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
- **Liquidation bonus assumption.** `checkPosition.ts` estimates seized
  collateral assuming near price-parity between debt and collateral assets
  for simplicity — before trusting it with real funds, replace that with an
  exact computation using Aave's `PriceOracle.getAssetPrice` for both assets.
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
