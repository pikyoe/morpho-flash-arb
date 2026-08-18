export const MOONWELL_COMPTROLLER_ABI: string[] = [
  "function getAccountLiquidity(address account) view returns (uint256 error, uint256 liquidity, uint256 shortfall)",
  "function closeFactorMantissa() view returns (uint256)",
  "function liquidationIncentiveMantissa() view returns (uint256)",
  "function protocolSeizeShareMantissa() view returns (uint256)",
  "function oracle() view returns (address)",
];

export const MOONWELL_MARKET_ABI: string[] = [
  "function liquidateBorrow(address borrower, uint256 repayAmount, address mTokenCollateral) returns (uint256)",
  "function redeem(uint256 redeemTokens) returns (uint256)",
  "function exchangeRateStored() view returns (uint256)",
  "function borrowBalanceStored(address account) view returns (uint256)",
  "function underlying() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "event Borrow(address borrower, uint256 borrowAmount, uint256 accountBorrows, uint256 totalBorrows)",
];

export const MOONWELL_ORACLE_ABI: string[] = [
  "function getUnderlyingPrice(address mToken) view returns (uint256)",
];

export const MOONWELL_OEV_WRAPPER_ABI: string[] = [
  "function updatePriceEarlyAndLiquidate(address borrower, uint256 repayAmount, address mTokenCollateral, address mTokenLoan)",
];

export const AERODROME_ROUTER_ABI: string[] = [
  "function getAmountsOut(uint256 amountIn, tuple(address from, address to, bool stable, address factory)[] routes) view returns (uint256[] amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple(address from,address to,bool stable,address factory)[] routes, address to, uint256 deadline) returns (uint256[] amounts)",
  "event Swap(address indexed sender, uint256 amountIn, uint256 amountOut, address indexed to, address indexed tokenIn, address tokenOut)",
];

export const ERC20_ABI: string[] = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

// Matches src/FlashLoanArbitrage.sol — update this if the contract's
// function signatures change. Nothing here is auto-synced from the .sol file.
export const FLASH_LOAN_ARBITRAGE_ABI: string[] = [
  "function executeArbitrage(address asset, uint256 amount, tuple(address target, uint256 value, bytes data)[] calls, uint256 minProfit)",
  "event ArbitrageExecuted(address indexed asset, uint256 amountBorrowed, uint256 profit)",
];
