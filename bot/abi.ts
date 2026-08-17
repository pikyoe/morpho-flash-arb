export const AAVE_V3_POOL_ABI: string[] = [
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
  "function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken)",
];

export const AAVE_POOL_RESERVES_ABI: string[] = [
  "function getReservesList() view returns (address[])",
  "function getReserveData(address asset) view returns (tuple(tuple(uint256 data) configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))",
];

export const AAVE_ORACLE_ABI: string[] = [
  "function getAssetPrice(address asset) view returns (uint256)",
  "function BASE_CURRENCY_UNIT() view returns (uint256)",
];

export const AERODROME_ROUTER_ABI: string[] = [
  "function getAmountsOut(uint256 amountIn, tuple(address from, address to, bool stable, address factory)[] routes) view returns (uint256[] amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple(address from,address to,bool stable,address factory)[] routes, address to, uint256 deadline) returns (uint256[] amounts)",
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
