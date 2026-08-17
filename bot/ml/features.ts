/**
 * Feature Engineering System for Flash Loan Arbitrage ML
 * 
 * This module provides comprehensive feature extraction from raw on-chain and off-chain data
 * to support machine learning models for arbitrage decision making.
 */

import { ethers } from "ethers";

// --- Feature Types ---

export interface PositionFeatures {
  // Basic position information
  userAddress: string;
  healthFactor: number;
  collateralUsd: number;
  debtUsd: number;
  
  // Collateral features
  collateralCount: number;
  collateralConcentration: number; // Herfindahl-Hirschman Index
  topCollateralPct: number;
  
  // Debt features
  debtCount: number;
  debtConcentration: number;
  topDebtPct: number;
  
  // Ratio features
  collateralToDebtRatio: number;
  liquidationThreshold: number;
  distanceToLiquidation: number;
  
  // Asset-specific features
  collateralAssets: string[];
  debtAssets: string[];
  assetVolatility: number[];
  assetCorrelation: number[][];
  
  // Temporal features
  positionAge: number; // in hours
  lastUpdate: number; // timestamp
}

export interface MarketFeatures {
  // Price features
  priceLevel: number;
  priceChange24h: number;
  priceChange1h: number;
  priceVolatility24h: number;
  priceVolatility1h: number;
  
  // Liquidity features
  liquidityDepth: number;
  liquidity24hChange: number;
  bidAskSpread: number;
  slippageEstimate: number;
  
  // Market structure
  marketCap: number;
  tradingVolume24h: number;
  tradingVolume1h: number;
  
  // Cross-asset features
  correlationWithBTC: number;
  correlationWithETH: number;
  betaToMarket: number;
  
  // Derivatives features
  openInterest: number;
  fundingRate: number;
  longShortRatio: number;
}

export interface NetworkFeatures {
  // Gas features
  gasPrice: number;
  gasPrice24hChange: number;
  gasPricePercentile: number;
  estimatedGasCost: number;
  
  // Block features
  blockTime: number;
  blockUtilization: number;
  pendingTransactions: number;
  
  // Mempool features
  mempoolSize: number;
  mempoolCongestion: number;
  pendingArbitrageTxs: number;
  
  // Network health
  networkStatus: 'healthy' | 'congested' | 'clogged';
  tps: number; // transactions per second
}

export interface CompetitionFeatures {
  // MEV bot activity
  mevBotCount: number;
  mevBotActivity24h: number;
  frontRunRate: number;
  sandwichRate: number;
  
  // Competition intensity
  competitionLevel: number; // 0-1 scale
  expectedCompetitors: number;
  winProbability: number;
  
  // Timing features
  optimalExecutionTime: number;
  timeToNextBlock: number;
  priorityFeeEstimate: number;
  
  // Historical patterns
  historicalWinRate: number;
  historicalProfitCompetition: number;
}

export interface TemporalFeatures {
  // Time features
  hourOfDay: number;
  dayOfWeek: number;
  isWeekend: boolean;
  isTradingHours: boolean;
  
  // Seasonal features
  monthOfYear: number;
  quarterOfYear: number;
  isQuarterEnd: boolean;
  
  // Market session
  marketSession: 'asia' | 'europe' | 'us' | 'overlap';
  volatilitySession: number;
  
  // Special events
  isHoliday: boolean;
  isEarningsSeason: boolean;
  nearOptionExpiry: boolean;
}

export interface MLOperationalFeatures {
  // Model input features
  positionFeatures: PositionFeatures;
  marketFeatures: MarketFeatures;
  networkFeatures: NetworkFeatures;
  competitionFeatures: CompetitionFeatures;
  temporalFeatures: TemporalFeatures;
  
  // Combined feature vector
  toFeatureVector(): number[];
}

// --- Feature Engineering ---

export class FeatureEngineer {
  private provider: ethers.JsonRpcProvider;
  private priceCache: Map<string, number[]> = new Map();
  private volatilityCache: Map<string, number> = new Map();
  
  constructor(provider: ethers.JsonRpcProvider) {
    this.provider = provider;
  }
  
  /**
   * Compute position features from raw position data
   */
  async computePositionFeatures(
    userAddress: string,
    collateral: { asset: string; amount: bigint; symbol: string; decimals: number }[],
    debt: { asset: string; amount: bigint; symbol: string; decimals: number }[],
    healthFactor: bigint,
    prices: Map<string, number>
  ): Promise<PositionFeatures> {
    // Calculate USD values
    const collateralUsd = this.calculateTotalUsd(collateral, prices);
    const debtUsd = this.calculateTotalUsd(debt, prices);
    
    // Calculate concentration metrics
    const collateralConcentration = this.calculateConcentration(collateral, prices);
    const debtConcentration = this.calculateConcentration(debt, prices);
    
    // Get top asset percentages
    const topCollateralPct = this.getTopAssetPct(collateral, prices);
    const topDebtPct = this.getTopAssetPct(debt, prices);
    
    // Calculate ratios
    const collateralToDebtRatio = collateralUsd / Math.max(debtUsd, 1);
    const distanceToLiquidation = Number(healthFactor) / 1e18 - 1;
    
    // Get asset volatilities
    const assetVolatility = await this.getAssetVolatilities([...collateral, ...debt]);
    
    // Calculate correlations
    const assetCorrelation = await this.calculateAssetCorrelations([...collateral, ...debt]);
    
    return {
      userAddress,
      healthFactor: Number(healthFactor) / 1e18,
      collateralUsd,
      debtUsd,
      collateralCount: collateral.length,
      collateralConcentration,
      topCollateralPct,
      debtCount: debt.length,
      debtConcentration,
      topDebtPct,
      collateralToDebtRatio,
      liquidationThreshold: 1.0, // Aave typically uses 1.0
      distanceToLiquidation,
      collateralAssets: collateral.map(c => c.asset),
      debtAssets: debt.map(d => d.asset),
      assetVolatility,
      assetCorrelation,
      positionAge: await this.getPositionAge(userAddress),
      lastUpdate: Date.now()
    };
  }
  
  /**
   * Compute market features from price data
   */
  async computeMarketFeatures(
    asset: string,
    currentPrice: number,
    historicalPrices: number[]
  ): Promise<MarketFeatures> {
    const priceChange24h = this.calculatePriceChange(historicalPrices, 24);
    const priceChange1h = this.calculatePriceChange(historicalPrices, 1);
    const priceVolatility24h = this.calculateVolatility(historicalPrices, 24);
    const priceVolatility1h = this.calculateVolatility(historicalPrices, 1);
    
    // Liquidity features (would need DEX integration)
    const liquidityDepth = await this.getLiquidityDepth(asset);
    const liquidity24hChange = await this.getLiquidityChange(asset, 24);
    const bidAskSpread = await this.getBidAskSpread(asset);
    const slippageEstimate = await this.estimateSlippage(asset, liquidityDepth);
    
    // Market structure
    const marketCap = await this.getMarketCap(asset);
    const tradingVolume24h = await this.getTradingVolume(asset, 24);
    const tradingVolume1h = await this.getTradingVolume(asset, 1);
    
    // Cross-asset correlations
    const correlationWithBTC = await this.getCorrelationWithBTC(asset);
    const correlationWithETH = await this.getCorrelationWithETH(asset);
    const betaToMarket = await this.calculateBeta(asset);
    
    // Derivatives (if applicable)
    const openInterest = await this.getOpenInterest(asset);
    const fundingRate = await this.getFundingRate(asset);
    const longShortRatio = await this.getLongShortRatio(asset);
    
    return {
      priceLevel: currentPrice,
      priceChange24h,
      priceChange1h,
      priceVolatility24h,
      priceVolatility1h,
      liquidityDepth,
      liquidity24hChange,
      bidAskSpread,
      slippageEstimate,
      marketCap,
      tradingVolume24h,
      tradingVolume1h,
      correlationWithBTC,
      correlationWithETH,
      betaToMarket,
      openInterest,
      fundingRate,
      longShortRatio
    };
  }
  
  /**
   * Compute network features from blockchain state
   */
  async computeNetworkFeatures(): Promise<NetworkFeatures> {
    const feeData = await this.provider.getFeeData();
    const gasPrice = Number(ethers.formatUnits(feeData.gasPrice || 0n, "gwei"));
    
    const block = await this.provider.getBlock("latest");
    const blockTime = block ? block.timestamp - (await this.provider.getBlock(block.number - 1))?.timestamp || 0 : 0;
    
    // Get historical gas prices for percentile calculation
    const gasPriceHistory = await this.getGasPriceHistory(24);
    const gasPricePercentile = this.calculatePercentile(gasPrice, gasPriceHistory);
    
    // Estimate gas cost for typical arbitrage
    const estimatedGasCost = gasPrice * 500000; // ~500k gas for typical arbitrage
    
    // Mempool features
    const mempoolSize = await this.getMempoolSize();
    const mempoolCongestion = this.calculateMempoolCongestion(mempoolSize);
    const pendingArbitrageTxs = await this.countPendingArbitrageTxs();
    
    // Network health classification
    const networkStatus = this.classifyNetworkStatus(gasPrice, mempoolCongestion);
    const tps = await this.calculateTPS();
    
    return {
      gasPrice,
      gasPrice24hChange: this.calculateGasPriceChange(gasPriceHistory),
      gasPricePercentile,
      estimatedGasCost,
      blockTime,
      blockUtilization: await this.getBlockUtilization(),
      pendingTransactions: mempoolSize,
      mempoolSize,
      mempoolCongestion,
      pendingArbitrageTxs,
      networkStatus,
      tps
    };
  }
  
  /**
   * Compute competition features from mempool analysis
   */
  async computeCompetitionFeatures(): Promise<CompetitionFeatures> {
    // MEV bot activity (would need mempool analysis)
    const mevBotCount = await this.countActiveMEVBots();
    const mevBotActivity24h = await this.getMEVBotActivity(24);
    const frontRunRate = await this.getFrontRunRate();
    const sandwichRate = await this.getSandwichRate();
    
    // Competition intensity
    const competitionLevel = await this.calculateCompetitionLevel();
    const expectedCompetitors = await this.estimateCompetitors();
    const winProbability = await this.estimateWinProbability();
    
    // Timing features
    const optimalExecutionTime = await this.calculateOptimalExecutionTime();
    const timeToNextBlock = await this.getTimeToNextBlock();
    const priorityFeeEstimate = await this.estimatePriorityFee();
    
    // Historical patterns
    const historicalWinRate = await this.getHistoricalWinRate();
    const historicalProfitCompetition = await this.getHistoricalProfitCompetition();
    
    return {
      mevBotCount,
      mevBotActivity24h,
      frontRunRate,
      sandwichRate,
      competitionLevel,
      expectedCompetitors,
      winProbability,
      optimalExecutionTime,
      timeToNextBlock,
      priorityFeeEstimate,
      historicalWinRate,
      historicalProfitCompetition
    };
  }
  
  /**
   * Compute temporal features from current time
   */
  computeTemporalFeatures(): TemporalFeatures {
    const now = new Date();
    const hourOfDay = now.getUTCHours();
    const dayOfWeek = now.getUTCDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    // Trading hours (rough UTC estimation)
    const isTradingHours = hourOfDay >= 8 && hourOfDay <= 20;
    
    // Seasonal features
    const monthOfYear = now.getUTCMonth();
    const quarterOfYear = Math.floor(monthOfYear / 3);
    const isQuarterEnd = monthOfYear === 2 || monthOfYear === 5 || monthOfYear === 8 || monthOfYear === 11;
    
    // Market session
    const marketSession = this.determineMarketSession(hourOfDay);
    const volatilitySession = this.getSessionVolatility(marketSession);
    
    // Special events (simplified)
    const isHoliday = this.isHoliday(now);
    const isEarningsSeason = this.isEarningsSeason(monthOfYear);
    const nearOptionExpiry = this.isNearOptionExpiry(now);
    
    return {
      hourOfDay,
      dayOfWeek,
      isWeekend,
      isTradingHours,
      monthOfYear,
      quarterOfYear,
      isQuarterEnd,
      marketSession,
      volatilitySession,
      isHoliday,
      isEarningsSeason,
      nearOptionExpiry
    };
  }
  
  /**
   * Combine all features into a single feature vector
   */
  async computeAllFeatures(
    userAddress: string,
    collateral: any[],
    debt: any[],
    healthFactor: bigint,
    prices: Map<string, number>,
    asset: string,
    currentPrice: number,
    historicalPrices: number[]
  ): Promise<MLOperationalFeatures> {
    const positionFeatures = await this.computePositionFeatures(
      userAddress, collateral, debt, healthFactor, prices
    );
    
    const marketFeatures = await this.computeMarketFeatures(
      asset, currentPrice, historicalPrices
    );
    
    const networkFeatures = await this.computeNetworkFeatures();
    
    const competitionFeatures = await this.computeCompetitionFeatures();
    
    const temporalFeatures = this.computeTemporalFeatures();
    
    return {
      positionFeatures,
      marketFeatures,
      networkFeatures,
      competitionFeatures,
      temporalFeatures,
      toFeatureVector: function() {
        return FeatureEngineer.flattenFeatures(this);
      }
    };
  }
  
  // --- Helper Methods ---
  
  private calculateTotalUsd(
    assets: { asset: string; amount: bigint; symbol: string; decimals: number }[],
    prices: Map<string, number>
  ): number {
    return assets.reduce((total, asset) => {
      const price = prices.get(asset.asset) || 0;
      const amountUsd = Number(asset.amount) / (10 ** asset.decimals) * price;
      return total + amountUsd;
    }, 0);
  }
  
  private calculateConcentration(
    assets: { asset: string; amount: bigint; symbol: string; decimals: number }[],
    prices: Map<string, number>
  ): number {
    const totalUsd = this.calculateTotalUsd(assets, prices);
    if (totalUsd === 0) return 0;
    
    const shares = assets.map(asset => {
      const assetUsd = Number(asset.amount) / (10 ** asset.decimals) * (prices.get(asset.asset) || 0);
      return assetUsd / totalUsd;
    });
    
    // Herfindahl-Hirschman Index
    return shares.reduce((sum, share) => sum + share * share, 0);
  }
  
  private getTopAssetPct(
    assets: { asset: string; amount: bigint; symbol: string; decimals: number }[],
    prices: Map<string, number>
  ): number {
    const totalUsd = this.calculateTotalUsd(assets, prices);
    if (totalUsd === 0) return 0;
    
    const maxUsd = Math.max(...assets.map(asset => {
      return Number(asset.amount) / (10 ** asset.decimals) * (prices.get(asset.asset) || 0);
    }));
    
    return maxUsd / totalUsd;
  }
  
  private async getAssetVolatilities(
    assets: { asset: string; amount: bigint; symbol: string; decimals: number }[]
  ): Promise<number[]> {
    // In production, this would fetch historical volatility data
    // For now, return mock data
    return assets.map(() => Math.random() * 0.5); // 0-50% daily volatility
  }
  
  private async calculateAssetCorrelations(
    assets: { asset: string; amount: bigint; symbol: string; decimals: number }[]
  ): Promise<number[][]> {
    // In production, this would calculate correlation matrix from historical returns
    const n = assets.length;
    const correlation: number[][] = [];
    
    for (let i = 0; i < n; i++) {
      correlation[i] = [];
      for (let j = 0; j < n; j++) {
        correlation[i][j] = i === j ? 1.0 : Math.random() * 0.8 - 0.4; // -0.4 to 0.4
      }
    }
    
    return correlation;
  }
  
  private async getPositionAge(userAddress: string): Promise<number> {
    // In production, this would query first interaction timestamp
    // For now, return mock data
    return Math.random() * 720; // 0-720 hours
  }
  
  private calculatePriceChange(prices: number[], hours: number): number {
    if (prices.length < hours + 1) return 0;
    const currentPrice = prices[0];
    const pastPrice = prices[hours];
    return ((currentPrice - pastPrice) / pastPrice) * 100;
  }
  
  private calculateVolatility(prices: number[], hours: number): number {
    if (prices.length < hours + 1) return 0;
    const subset = prices.slice(0, hours + 1);
    const returns = [];
    
    for (let i = 1; i < subset.length; i++) {
      returns.push((subset[i] - subset[i - 1]) / subset[i - 1]);
    }
    
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance) * Math.sqrt(24 * 365); // Annualized
  }
  
  private calculatePercentile(value: number, values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = sorted.findIndex(v => v >= value);
    return (index / sorted.length) * 100;
  }
  
  private classifyNetworkStatus(gasPrice: number, congestion: number): 'healthy' | 'congested' | 'clogged' {
    if (gasPrice > 50 || congestion > 0.8) return 'clogged';
    if (gasPrice > 30 || congestion > 0.5) return 'congested';
    return 'healthy';
  }
  
  private determineMarketSession(hour: number): 'asia' | 'europe' | 'us' | 'overlap' {
    if (hour >= 0 && hour < 8) return 'asia';
    if (hour >= 8 && hour < 16) return 'europe';
    if (hour >= 16 && hour < 24) return 'us';
    return 'us'; // fallback
  }
  
  private getSessionVolatility(session: string): number {
    const volatilityMap: Record<string, number> = {
      'asia': 0.3,
      'europe': 0.5,
      'us': 0.7,
      'overlap': 0.9
    };
    return volatilityMap[session] || 0.5;
  }
  
  private isHoliday(date: Date): boolean {
    // Simplified holiday check
    const holidays = [
      '01-01', '07-04', '12-25' // US holidays
    ];
    const dateStr = `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    return holidays.includes(dateStr);
  }
  
  private isEarningsSeason(month: number): boolean {
    // Earnings seasons: Jan, Apr, Jul, Oct
    return [0, 3, 6, 9].includes(month);
  }
  
  private isNearOptionExpiry(date: Date): boolean {
    // Options expire on Fridays
    return date.getUTCDay() === 5;
  }
  
  // --- Placeholder methods for external data sources ---
  
  private async getLiquidityDepth(asset: string): Promise<number> {
    // Would integrate with DEX for real liquidity data
    return Math.random() * 1000000;
  }
  
  private async getLiquidityChange(asset: string, hours: number): Promise<number> {
    return (Math.random() - 0.5) * 20; // -10% to +10%
  }
  
  private async getBidAskSpread(asset: string): Promise<number> {
    return Math.random() * 0.01; // 0-1% spread
  }
  
  private async estimateSlippage(asset: string, liquidity: number): Promise<number> {
    return Math.random() * 0.5; // 0-0.5% slippage
  }
  
  private async getMarketCap(asset: string): Promise<number> {
    return Math.random() * 1000000000000; // Up to $1T
  }
  
  private async getTradingVolume(asset: string, hours: number): Promise<number> {
    return Math.random() * 1000000000; // Up to $1B
  }
  
  private async getCorrelationWithBTC(asset: string): Promise<number> {
    return Math.random() * 0.8 - 0.4; // -0.4 to 0.4
  }
  
  private async getCorrelationWithETH(asset: string): Promise<number> {
    return Math.random() * 0.9 - 0.45; // -0.45 to 0.45
  }
  
  private async calculateBeta(asset: string): Promise<number> {
    return Math.random() * 2 - 0.5; // -0.5 to 1.5
  }
  
  private async getOpenInterest(asset: string): Promise<number> {
    return Math.random() * 1000000000; // Up to $1B
  }
  
  private async getFundingRate(asset: string): Promise<number> {
    return (Math.random() - 0.5) * 0.01; // -0.5% to +0.5%
  }
  
  private async getLongShortRatio(asset: string): Promise<number> {
    return Math.random() * 2; // 0 to 2
  }
  
  private async getGasPriceHistory(hours: number): Promise<number[]> {
    // Would fetch historical gas prices
    return Array(hours).fill(0).map(() => Math.random() * 50 + 10);
  }
  
  private calculateGasPriceChange(history: number[]): number {
    if (history.length < 2) return 0;
    const current = history[0];
    const previous = history[history.length - 1];
    return ((current - previous) / previous) * 100;
  }
  
  private async getMempoolSize(): Promise<number> {
    return Math.floor(Math.random() * 10000);
  }
  
  private calculateMempoolCongestion(size: number): number {
    return Math.min(size / 5000, 1); // Normalize to 0-1
  }
  
  private async countPendingArbitrageTxs(): Promise<number> {
    return Math.floor(Math.random() * 50);
  }
  
  private async getBlockUtilization(): Promise<number> {
    return Math.random(); // 0-1
  }
  
  private async calculateTPS(): Promise<number> {
    return Math.random() * 100 + 10; // 10-110 TPS
  }
  
  private async countActiveMEVBots(): Promise<number> {
    return Math.floor(Math.random() * 20);
  }
  
  private async getMEVBotActivity(hours: number): Promise<number> {
    return Math.random() * 1000;
  }
  
  private async getFrontRunRate(): Promise<number> {
    return Math.random() * 0.3; // 0-30%
  }
  
  private async getSandwichRate(): Promise<number> {
    return Math.random() * 0.2; // 0-20%
  }
  
  private async calculateCompetitionLevel(): Promise<number> {
    return Math.random(); // 0-1
  }
  
  private async estimateCompetitors(): Promise<number> {
    return Math.floor(Math.random() * 10);
  }
  
  private async estimateWinProbability(): Promise<number> {
    return Math.random() * 0.5 + 0.25; // 25-75%
  }
  
  private async calculateOptimalExecutionTime(): Promise<number> {
    return Date.now() + Math.random() * 30000; // Within 30 seconds
  }
  
  private async getTimeToNextBlock(): Promise<number> {
    return Math.random() * 12; // 0-12 seconds
  }
  
  private async estimatePriorityFee(): Promise<number> {
    return Math.random() * 5; // 0-5 gwei
  }
  
  private async getHistoricalWinRate(): Promise<number> {
    return Math.random() * 0.4 + 0.3; // 30-70%
  }
  
  private async getHistoricalProfitCompetition(): Promise<number> {
    return Math.random() * 0.3; // 0-30% profit reduction due to competition
  }
  
  /**
   * Flatten all features into a single vector for ML models
   */
  static flattenFeatures(features: MLOperationalFeatures): number[] {
    const vector: number[] = [];
    
    // Position features
    vector.push(
      features.positionFeatures.healthFactor,
      features.positionFeatures.collateralUsd,
      features.positionFeatures.debtUsd,
      features.positionFeatures.collateralCount,
      features.positionFeatures.collateralConcentration,
      features.positionFeatures.topCollateralPct,
      features.positionFeatures.debtCount,
      features.positionFeatures.debtConcentration,
      features.positionFeatures.topDebtPct,
      features.positionFeatures.collateralToDebtRatio,
      features.positionFeatures.distanceToLiquidation,
      ...features.positionFeatures.assetVolatility,
      features.positionFeatures.positionAge
    );
    
    // Market features
    vector.push(
      features.marketFeatures.priceChange24h,
      features.marketFeatures.priceChange1h,
      features.marketFeatures.priceVolatility24h,
      features.marketFeatures.priceVolatility1h,
      features.marketFeatures.liquidityDepth,
      features.marketFeatures.liquidity24hChange,
      features.marketFeatures.bidAskSpread,
      features.marketFeatures.slippageEstimate,
      features.marketFeatures.marketCap,
      features.marketFeatures.tradingVolume24h,
      features.marketFeatures.tradingVolume1h,
      features.marketFeatures.correlationWithBTC,
      features.marketFeatures.correlationWithETH,
      features.marketFeatures.betaToMarket,
      features.marketFeatures.openInterest,
      features.marketFeatures.fundingRate,
      features.marketFeatures.longShortRatio
    );
    
    // Network features
    vector.push(
      features.networkFeatures.gasPrice,
      features.networkFeatures.gasPrice24hChange,
      features.networkFeatures.gasPricePercentile,
      features.networkFeatures.estimatedGasCost,
      features.networkFeatures.blockTime,
      features.networkFeatures.blockUtilization,
      features.networkFeatures.pendingTransactions,
      features.networkFeatures.mempoolSize,
      features.networkFeatures.mempoolCongestion,
      features.networkFeatures.pendingArbitrageTxs,
      features.networkFeatures.tps
    );
    
    // Competition features
    vector.push(
      features.competitionFeatures.mevBotCount,
      features.competitionFeatures.mevBotActivity24h,
      features.competitionFeatures.frontRunRate,
      features.competitionFeatures.sandwichRate,
      features.competitionFeatures.competitionLevel,
      features.competitionFeatures.expectedCompetitors,
      features.competitionFeatures.winProbability,
      features.competitionFeatures.priorityFeeEstimate,
      features.competitionFeatures.historicalWinRate,
      features.competitionFeatures.historicalProfitCompetition
    );
    
    // Temporal features
    vector.push(
      features.temporalFeatures.hourOfDay / 24,
      features.temporalFeatures.dayOfWeek / 7,
      features.temporalFeatures.isWeekend ? 1 : 0,
      features.temporalFeatures.isTradingHours ? 1 : 0,
      features.temporalFeatures.monthOfYear / 12,
      features.temporalFeatures.quarterOfYear / 4,
      features.temporalFeatures.isQuarterEnd ? 1 : 0,
      features.temporalFeatures.volatilitySession,
      features.temporalFeatures.isHoliday ? 1 : 0,
      features.temporalFeatures.isEarningsSeason ? 1 : 0,
      features.temporalFeatures.nearOptionExpiry ? 1 : 0
    );
    
    return vector;
  }
}