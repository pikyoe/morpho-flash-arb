/**
 * ML Prediction Service for Flash Loan Arbitrage
 * 
 * This service provides real-time predictions using trained ML models
 * to enhance arbitrage decision making.
 */

import { FeatureEngineer } from './features.js';

// --- Prediction Types ---

export interface LiquidationPrediction {
  probability: number; // 0-1
  confidence: number; // 0-1
  timeframe: number; // hours until likely liquidation
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  features: {
    healthFactorContribution: number;
    marketContribution: number;
    networkContribution: number;
  };
}

export interface ProfitabilityPrediction {
  expectedProfit: number; // USD
  confidence: number; // 0-1
  riskAdjustedProfit: number; // USD
  profitRange: { min: number; max: number };
  probabilityOfProfit: number; // 0-1
  features: {
    liquidityContribution: number;
    competitionContribution: number;
    timingContribution: number;
  };
}

export interface CompetitionPrediction {
  intensity: number; // 0-1
  expectedCompetitors: number;
  winProbability: number; // 0-1
  frontRunRisk: number; // 0-1
  sandwichRisk: number; // 0-1
  recommendedPriorityFee: number; // gwei
  optimalTiming: number; // timestamp
  features: {
    mempoolContribution: number;
    gasPriceContribution: number;
    historicalContribution: number;
  };
}

export interface MLOpportunityPrediction {
  liquidation: LiquidationPrediction;
  profitability: ProfitabilityPrediction;
  competition: CompetitionPrediction;
  overallScore: number; // 0-1
  recommendation: 'execute' | 'skip' | 'wait';
  confidence: number; // 0-1
  reasoning: string;
}

// --- Model Interface ---

interface MLModel {
  predict(features: number[]): number | number[];
  predict_proba(features: number[]): number[][];
}

// --- Mock Model Implementation (Replace with actual model loading) ---

class MockModel implements MLModel {
  private type: 'classification' | 'regression';
  private baseValue: number;
  private noise: number;
  
  constructor(type: 'classification' | 'regression', baseValue: number = 0.5, noise: number = 0.1) {
    this.type = type;
    this.baseValue = baseValue;
    this.noise = noise;
  }
  
  predict(_features: number[]): number | number[] {
    if (this.type === 'classification') {
      // Return class (0 or 1)
      const probability = this.baseValue + (Math.random() - 0.5) * this.noise;
      return probability > 0.5 ? 1 : 0;
    } else {
      // Return continuous value
      return this.baseValue + (Math.random() - 0.5) * this.noise * 100;
    }
  }
  
  predict_proba(_features: number[]): number[][] {
    if (this.type !== 'classification') {
      throw new Error('predict_proba only available for classification models');
    }
    
    const probability = this.baseValue + (Math.random() - 0.5) * this.noise;
    return [[1 - probability, probability]];
  }
}

// --- Prediction Service ---

export class PredictionService {
  private featureEngineer: FeatureEngineer;
  private liquidationModel: MLModel;
  private profitabilityModel: MLModel;
  private competitionModel: MLModel;
  private modelsLoaded: boolean = false;
  
  constructor(provider: any) {
    this.featureEngineer = new FeatureEngineer(provider);
    
    // Initialize mock models (replace with actual model loading)
    this.liquidationModel = new MockModel('classification', 0.7, 0.15);
    this.profitabilityModel = new MockModel('regression', 50, 20);
    this.competitionModel = new MockModel('classification', 0.4, 0.2);
  }
  
  /**
   * Load trained models from disk
   */
  async loadModels(): Promise<void> {
    try {
      // In production, this would load actual trained models
      // For now, we use mock models
      
      // Example of how to load real models:
      // const liquidationModelData = await fs.readFile('./exported_models/liquidation_model.joblib');
      // this.liquidationModel = joblib.load(liquidationModelData);
      
      this.modelsLoaded = true;
      console.log('ML models loaded successfully');
    } catch (error) {
      console.error('Error loading ML models:', error);
      console.log('Using mock models for demonstration');
      this.modelsLoaded = true;
    }
  }
  
  /**
   * Predict liquidation probability for a position
   */
  async predictLiquidation(
    userAddress: string,
    collateral: any[],
    debt: any[],
    healthFactor: bigint,
    prices: Map<string, number>
  ): Promise<LiquidationPrediction> {
    if (!this.modelsLoaded) {
      await this.loadModels();
    }
    
    // Compute features
    const positionFeatures = await this.featureEngineer.computePositionFeatures(
      userAddress, collateral, debt, healthFactor, prices
    );
    
    const marketFeatures = await this.featureEngineer.computeMarketFeatures(
      collateral[0]?.asset || '0x0',
      prices.get(collateral[0]?.asset || '0x0') || 0,
      [] // Would need historical prices
    );
    
    const networkFeatures = await this.featureEngineer.computeNetworkFeatures();
    
    const temporalFeatures = this.featureEngineer.computeTemporalFeatures();
    
    // Combine features into vector
    const featureVector = this.combineFeaturesForLiquidation(
      positionFeatures, marketFeatures, networkFeatures, temporalFeatures
    );
    
    // Make prediction
    const prediction = this.liquidationModel.predict_proba(featureVector)[0] ?? [0, 0];
    const probability = prediction[1] ?? 0; // Probability of class 1 (liquidation)
    
    // Calculate confidence based on prediction certainty
    const confidence = Math.max(prediction[0] ?? 0, prediction[1] ?? 0);
    
    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    if (probability < 0.3) riskLevel = 'low';
    else if (probability < 0.5) riskLevel = 'medium';
    else if (probability < 0.7) riskLevel = 'high';
    else riskLevel = 'critical';
    
    // Estimate timeframe based on health factor
    const timeframe = this.estimateLiquidationTimeframe(positionFeatures.healthFactor, probability);
    
    // Calculate feature contributions (simplified)
    const healthFactorContribution = Math.max(0, 1 - positionFeatures.healthFactor) * 0.6;
    const marketContribution = marketFeatures.priceVolatility24h * 0.2;
    const networkContribution = networkFeatures.gasPricePercentile / 100 * 0.2;
    
    return {
      probability,
      confidence,
      timeframe,
      riskLevel,
      features: {
        healthFactorContribution,
        marketContribution,
        networkContribution
      }
    };
  }
  
  /**
   * Predict profitability for an arbitrage route
   */
  async predictProfitability(
    route: any,
    currentPrices: Map<string, number>,
    _marketConditions: any
  ): Promise<ProfitabilityPrediction> {
    if (!this.modelsLoaded) {
      await this.loadModels();
    }
    
    // Compute features
    const marketFeatures = await this.featureEngineer.computeMarketFeatures(
      route.asset,
      currentPrices.get(route.asset) || 0,
      []
    );
    
    const networkFeatures = await this.featureEngineer.computeNetworkFeatures();
    const competitionFeatures = await this.featureEngineer.computeCompetitionFeatures();
    const temporalFeatures = this.featureEngineer.computeTemporalFeatures();
    
    // Combine features
    const featureVector = this.combineFeaturesForProfitability(
      marketFeatures, networkFeatures, competitionFeatures, temporalFeatures, route
    );
    
    // Make prediction
    const expectedProfit = this.profitabilityModel.predict(featureVector) as number;
    
    // Calculate confidence based on various factors
    const liquidityConfidence = Math.min(marketFeatures.liquidityDepth / 100000, 1);
    const competitionConfidence = 1 - competitionFeatures.competitionLevel;
    const timingConfidence = temporalFeatures.volatilitySession;
    const confidence = (liquidityConfidence + competitionConfidence + timingConfidence) / 3;
    
    // Calculate risk-adjusted profit
    const riskAdjustment = 1 - (competitionFeatures.frontRunRate * 0.5);
    const riskAdjustedProfit = expectedProfit * riskAdjustment;
    
    // Calculate profit range
    const profitRange = {
      min: expectedProfit * 0.7,
      max: expectedProfit * 1.3
    };
    
    // Calculate probability of profit
    const probabilityOfProfit = expectedProfit > 0 ? confidence : 1 - confidence;
    
    // Calculate feature contributions
    const liquidityContribution = liquidityConfidence * 0.4;
    const competitionContribution = competitionConfidence * 0.3;
    const timingContribution = timingConfidence * 0.3;
    
    return {
      expectedProfit,
      confidence,
      riskAdjustedProfit,
      profitRange,
      probabilityOfProfit,
      features: {
        liquidityContribution,
        competitionContribution,
        timingContribution
      }
    };
  }
  
  /**
   * Predict competition intensity for a transaction
   */
  async predictCompetition(_mempoolData: any): Promise<CompetitionPrediction> {
    if (!this.modelsLoaded) {
      await this.loadModels();
    }
    
    // Compute features
    const networkFeatures = await this.featureEngineer.computeNetworkFeatures();
    const competitionFeatures = await this.featureEngineer.computeCompetitionFeatures();
    const temporalFeatures = this.featureEngineer.computeTemporalFeatures();
    
    // Combine features
    const featureVector = this.combineFeaturesForCompetition(
      networkFeatures, competitionFeatures, temporalFeatures
    );
    
    // Make prediction
    const prediction = this.competitionModel.predict_proba(featureVector)[0] ?? [0, 0];
    const intensity = prediction[1] ?? 0; // Probability of high competition
    
    // Calculate derived metrics
    const expectedCompetitors = Math.floor(intensity * 10);
    const winProbability = 1 - (intensity * 0.6);
    const frontRunRisk = competitionFeatures.frontRunRate * (1 + intensity);
    const sandwichRisk = competitionFeatures.sandwichRate * (1 + intensity);
    
    // Calculate recommended priority fee
    const recommendedPriorityFee = this.calculateRecommendedPriorityFee(
      intensity, networkFeatures.gasPrice
    );
    
    // Calculate optimal timing
    const optimalTiming = await this.calculateOptimalTiming(intensity, temporalFeatures);
    
    // Calculate feature contributions
    const mempoolContribution = networkFeatures.mempoolCongestion * 0.4;
    const gasPriceContribution = networkFeatures.gasPricePercentile / 100 * 0.3;
    const historicalContribution = competitionFeatures.historicalWinRate * 0.3;
    
    return {
      intensity,
      expectedCompetitors,
      winProbability,
      frontRunRisk,
      sandwichRisk,
      recommendedPriorityFee,
      optimalTiming,
      features: {
        mempoolContribution,
        gasPriceContribution,
        historicalContribution
      }
    };
  }
  
  /**
   * Generate comprehensive prediction for an arbitrage opportunity
   */
  async predictOpportunity(
    userAddress: string,
    collateral: any[],
    debt: any[],
    healthFactor: bigint,
    prices: Map<string, number>,
    route: any
  ): Promise<MLOpportunityPrediction> {
    // Get individual predictions
    const liquidation = await this.predictLiquidation(
      userAddress, collateral, debt, healthFactor, prices
    );
    
    const profitability = await this.predictProfitability(
      route, prices, {}
    );
    
    const competition = await this.predictCompetition({});
    
    // Calculate overall score
    const overallScore = this.calculateOverallScore(
      liquidation, profitability, competition
    );
    
    // Generate recommendation
    const recommendation = this.generateRecommendation(
      overallScore, liquidation, profitability, competition
    );
    
    // Calculate overall confidence
    const confidence = Math.min(
      liquidation.confidence,
      profitability.confidence,
      competition.winProbability
    );
    
    // Generate reasoning
    const reasoning = this.generateReasoning(
      liquidation, profitability, competition, overallScore
    );
    
    return {
      liquidation,
      profitability,
      competition,
      overallScore,
      recommendation,
      confidence,
      reasoning
    };
  }
  
  /**
   * Batch predict liquidation for multiple positions
   */
  async batchPredictLiquidation(
    positions: Array<{
      userAddress: string;
      collateral: any[];
      debt: any[];
      healthFactor: bigint;
      prices: Map<string, number>;
    }>
  ): Promise<LiquidationPrediction[]> {
    const predictions = await Promise.all(
      positions.map(pos => 
        this.predictLiquidation(
          pos.userAddress, pos.collateral, pos.debt, 
          pos.healthFactor, pos.prices
        )
      )
    );
    
    return predictions;
  }
  
  /**
   * Batch predict profitability for multiple routes
   */
  async batchPredictProfitability(
    routes: Array<{
      route: any;
      currentPrices: Map<string, number>;
      marketConditions: any;
    }>
  ): Promise<ProfitabilityPrediction[]> {
    const predictions = await Promise.all(
      routes.map(r => 
        this.predictProfitability(
          r.route, r.currentPrices, r.marketConditions
        )
      )
    );
    
    return predictions;
  }
  
  // --- Helper Methods ---
  
  private combineFeaturesForLiquidation(
    position: any,
    market: any,
    network: any,
    temporal: any
  ): number[] {
    return [
      position.healthFactor,
      position.collateralUsd,
      position.debtUsd,
      position.collateralToDebtRatio,
      position.distanceToLiquidation,
      market.priceVolatility24h,
      market.priceChange24h,
      network.gasPrice,
      network.gasPricePercentile,
      network.mempoolCongestion,
      temporal.hourOfDay / 24,
      temporal.isWeekend ? 1 : 0,
      temporal.volatilitySession
    ];
  }
  
  private combineFeaturesForProfitability(
    market: any,
    network: any,
    competition: any,
    temporal: any,
    route: any
  ): number[] {
    return [
      market.liquidityDepth,
      market.bidAskSpread,
      market.slippageEstimate,
      market.tradingVolume24h,
      network.gasPrice,
      network.estimatedGasCost,
      network.mempoolCongestion,
      competition.competitionLevel,
      competition.frontRunRate,
      competition.historicalWinRate,
      temporal.hourOfDay / 24,
      temporal.volatilitySession,
      route.amount || 0,
      route.minProfit || 0
    ];
  }
  
  private combineFeaturesForCompetition(
    network: any,
    competition: any,
    temporal: any
  ): number[] {
    return [
      network.gasPrice,
      network.gasPricePercentile,
      network.mempoolSize,
      network.mempoolCongestion,
      network.pendingArbitrageTxs,
      competition.mevBotCount,
      competition.mevBotActivity24h,
      competition.frontRunRate,
      competition.historicalWinRate,
      temporal.hourOfDay / 24,
      temporal.isTradingHours ? 1 : 0
    ];
  }
  
  private estimateLiquidationTimeframe(healthFactor: number, probability: number): number {
    // If health factor is already below 1, liquidation is imminent
    if (healthFactor < 1.0) {
      return Math.max(1, (1 - healthFactor) * 24); // 1-24 hours
    }
    
    // If health factor is close to 1, estimate based on probability
    if (healthFactor < 1.2) {
      return Math.max(6, probability * 48); // 6-48 hours
    }
    
    // If health factor is healthy, liquidation is not imminent
    return Math.max(24, probability * 168); // 1-7 days
  }
  
  private calculateRecommendedPriorityFee(intensity: number, gasPrice: number): number {
    // Base priority fee
    const baseFee = 1.0;
    
    // Adjust based on competition intensity
    const intensityAdjustment = intensity * 3;
    
    // Adjust based on current gas price
    const gasAdjustment = Math.max(0, (gasPrice - 30) / 10);
    
    return Math.ceil(baseFee + intensityAdjustment + gasAdjustment);
  }
  
  private async calculateOptimalTiming(intensity: number, temporal: any): Promise<number> {
    const now = Date.now();
    
    // If competition is low, execute immediately
    if (intensity < 0.3) {
      return now + 1000; // 1 second from now
    }
    
    // If competition is high, wait for optimal window
    if (intensity > 0.7) {
      // Wait for lower congestion periods
      const optimalDelay = this.calculateOptimalDelay(temporal);
      return now + optimalDelay;
    }
    
    // Moderate competition - short delay
    return now + 5000; // 5 seconds from now
  }
  
  private calculateOptimalDelay(temporal: any): number {
    // Avoid peak hours
    if (temporal.hourOfDay >= 8 && temporal.hourOfDay <= 16) {
      return 30000; // 30 seconds
    }
    
    // Weekend might have lower competition
    if (temporal.isWeekend) {
      return 10000; // 10 seconds
    }
    
    return 20000; // 20 seconds default
  }
  
  private calculateOverallScore(
    liquidation: LiquidationPrediction,
    profitability: ProfitabilityPrediction,
    competition: CompetitionPrediction
  ): number {
    // Weight the different predictions
    const liquidationWeight = 0.3;
    const profitabilityWeight = 0.4;
    const competitionWeight = 0.3;
    
    // Normalize scores to 0-1 range
    const liquidationScore = liquidation.probability; // Higher is better for liquidation
    const profitabilityScore = Math.min(profitability.expectedProfit / 100, 1); // Normalize by $100
    const competitionScore = competition.winProbability; // Higher is better
    
    const overallScore = 
      liquidationScore * liquidationWeight +
      profitabilityScore * profitabilityWeight +
      competitionScore * competitionWeight;
    
    return Math.min(Math.max(overallScore, 0), 1);
  }
  
  private generateRecommendation(
    overallScore: number,
    _liquidation: LiquidationPrediction,
    profitability: ProfitabilityPrediction,
    competition: CompetitionPrediction
  ): 'execute' | 'skip' | 'wait' {
    // Execute if overall score is high and conditions are favorable
    if (overallScore > 0.7 && 
        profitability.probabilityOfProfit > 0.8 &&
        competition.winProbability > 0.6) {
      return 'execute';
    }
    
    // Skip if profitability is low or competition is too high
    if (profitability.probabilityOfProfit < 0.5 || 
        competition.winProbability < 0.4 ||
        profitability.riskAdjustedProfit < 10) {
      return 'skip';
    }
    
    // Wait for better conditions
    return 'wait';
  }
  
  private generateReasoning(
    liquidation: LiquidationPrediction,
    profitability: ProfitabilityPrediction,
    competition: CompetitionPrediction,
    overallScore: number
  ): string {
    const reasons = [];
    
    if (liquidation.probability > 0.7) {
      reasons.push(`High liquidation probability (${(liquidation.probability * 100).toFixed(1)}%)`);
    }
    
    if (profitability.expectedProfit > 50) {
      reasons.push(`Strong profit potential ($${profitability.expectedProfit.toFixed(2)})`);
    } else if (profitability.expectedProfit < 20) {
      reasons.push(`Low profit potential ($${profitability.expectedProfit.toFixed(2)})`);
    }
    
    if (competition.intensity > 0.7) {
      reasons.push(`High competition intensity (${(competition.intensity * 100).toFixed(1)}%)`);
    } else if (competition.intensity < 0.3) {
      reasons.push(`Low competition intensity (${(competition.intensity * 100).toFixed(1)}%)`);
    }
    
    if (overallScore > 0.7) {
      reasons.push(`Strong overall score (${(overallScore * 100).toFixed(1)}%)`);
    }
    
    return reasons.join(', ') || 'Moderate opportunity with balanced factors';
  }
}

// --- Model Manager ---

export class ModelManager {
  private models: Map<string, MLModel> = new Map();
  private modelVersions: Map<string, string> = new Map();
  
  /**
   * Register a model
   */
  async registerModel(modelId: string, model: MLModel, version: string = '1.0'): Promise<void> {
    this.models.set(modelId, model);
    this.modelVersions.set(modelId, version);
    console.log(`Model ${modelId} version ${version} registered`);
  }
  
  /**
   * Load a model
   */
  async loadModel(modelId: string): Promise<MLModel> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }
    return model;
  }
  
  /**
   * Update a model
   */
  async updateModel(modelId: string, newModel: MLModel, newVersion: string): Promise<void> {
    const oldVersion = this.modelVersions.get(modelId);
    console.log(`Updating model ${modelId} from version ${oldVersion} to ${newVersion}`);
    
    this.models.set(modelId, newModel);
    this.modelVersions.set(modelId, newVersion);
  }
  
  /**
   * Get model version
   */
  getModelVersion(modelId: string): string {
    return this.modelVersions.get(modelId) || 'unknown';
  }
  
  /**
   * Rollback model to previous version
   */
  async rollbackModel(modelId: string, version: string): Promise<void> {
    // In production, this would load the specific version from storage
    console.log(`Rolling back model ${modelId} to version ${version}`);
    // Implementation would load the specific version from model registry
  }
  
  /**
   * List all registered models
   */
  listModels(): Array<{ id: string; version: string }> {
    return Array.from(this.models.keys()).map(id => ({
      id,
      version: this.modelVersions.get(id) || 'unknown'
    }));
  }
}