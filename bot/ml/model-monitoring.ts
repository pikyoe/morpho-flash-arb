/**
 * Model Monitoring System for ML-Enhanced Arbitrage
 * 
 * This system monitors model performance, detects drift, and manages
 * the model lifecycle to ensure continued effectiveness.
 */

import { ethers } from "ethers";

// --- Types ---

export interface PredictionRecord {
  timestamp: number;
  modelId: string;
  modelVersion: string;
  prediction: any;
  actualOutcome?: any;
  features: any;
  confidence: number;
  executionTime: number;
}

export interface ModelPerformanceMetrics {
  modelId: string;
  modelVersion: string;
  timestamp: number;
  
  // Classification metrics
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1Score?: number;
  rocAuc?: number;
  
  // Regression metrics
  mse?: number;
  rmse?: number;
  mae?: number;
  r2Score?: number;
  
  // Business metrics
  profitImprovement?: number;
  winRateImprovement?: number;
  lossReduction?: number;
  
  // Operational metrics
  averageLatency: number;
  throughput: number;
  errorRate: number;
}

export interface DriftDetectionResult {
  timestamp: number;
  modelId: string;
  modelVersion: string;
  
  featureDrift: {
    detected: boolean;
    severity: 'low' | 'medium' | 'high';
    driftedFeatures: string[];
    klDivergence: number;
  };
  
  conceptDrift: {
    detected: boolean;
    severity: 'low' | 'medium' | 'high';
    performanceDegradation: number;
  };
  
  dataDrift: {
    detected: boolean;
    severity: 'low' | 'medium' | 'high';
    statisticalTests: string[];
  };
  
  recommendation: 'no_action' | 'monitor' | 'retrain' | 'emergency_retrain';
}

export interface ModelHealthStatus {
  modelId: string;
  modelVersion: string;
  timestamp: number;
  
  status: 'healthy' | 'degraded' | 'critical';
  overallHealthScore: number; // 0-100
  
  performanceScore: number;
  driftScore: number;
  operationalScore: number;
  
  alerts: ModelAlert[];
  recommendations: string[];
}

export interface ModelAlert {
  timestamp: number;
  severity: 'info' | 'warning' | 'critical';
  type: string;
  message: string;
  details?: any;
}

// --- Monitoring Storage ---

class MonitoringStorage {
  private predictions: Map<string, PredictionRecord[]> = new Map();
  private performanceMetrics: Map<string, ModelPerformanceMetrics[]> = new Map();
  private alerts: ModelAlert[] = [];
  
  /**
   * Store a prediction record
   */
  async storePrediction(record: PredictionRecord): Promise<void> {
    const key = `${record.modelId}_${record.modelVersion}`;
    if (!this.predictions.has(key)) {
      this.predictions.set(key, []);
    }
    this.predictions.get(key)!.push(record);
    
    // Keep only last 10000 predictions per model
    const predictions = this.predictions.get(key)!;
    if (predictions.length > 10000) {
      predictions.splice(0, predictions.length - 10000);
    }
  }
  
  /**
   * Get recent predictions for a model
   */
  async getPredictions(modelId: string, modelVersion: string, limit: number = 1000): Promise<PredictionRecord[]> {
    const key = `${modelId}_${modelVersion}`;
    const predictions = this.predictions.get(key) || [];
    return predictions.slice(-limit);
  }
  
  /**
   * Store performance metrics
   */
  async storePerformanceMetrics(metrics: ModelPerformanceMetrics): Promise<void> {
    const key = `${metrics.modelId}_${metrics.modelVersion}`;
    if (!this.performanceMetrics.has(key)) {
      this.performanceMetrics.set(key, []);
    }
    this.performanceMetrics.get(key)!.push(metrics);
    
    // Keep only last 1000 metrics entries
    const metricsList = this.performanceMetrics.get(key)!;
    if (metricsList.length > 1000) {
      metricsList.splice(0, metricsList.length - 1000);
    }
  }
  
  /**
   * Get recent performance metrics
   */
  async getPerformanceMetrics(modelId: string, modelVersion: string, limit: number = 100): Promise<ModelPerformanceMetrics[]> {
    const key = `${modelId}_${modelVersion}`;
    const metrics = this.performanceMetrics.get(key) || [];
    return metrics.slice(-limit);
  }
  
  /**
   * Add an alert
   */
  async addAlert(alert: ModelAlert): Promise<void> {
    this.alerts.push(alert);
    
    // Keep only last 1000 alerts
    if (this.alerts.length > 1000) {
      this.alerts.splice(0, this.alerts.length - 1000);
    }
  }
  
  /**
   * Get recent alerts
   */
  async getAlerts(limit: number = 100): Promise<ModelAlert[]> {
    return this.alerts.slice(-limit);
  }
}

// --- Performance Tracker ---

export class PerformanceTracker {
  private storage: MonitoringStorage;
  
  constructor(storage: MonitoringStorage) {
    this.storage = storage;
  }
  
  /**
   * Track a prediction and its outcome
   */
  async trackPrediction(
    modelId: string,
    modelVersion: string,
    prediction: any,
    features: any,
    confidence: number,
    executionTime: number
  ): Promise<void> {
    const record: PredictionRecord = {
      timestamp: Date.now(),
      modelId,
      modelVersion,
      prediction,
      features,
      confidence,
      executionTime
    };
    
    await this.storage.storePrediction(record);
  }
  
  /**
   * Record the actual outcome of a prediction
   */
  async recordOutcome(
    modelId: string,
    modelVersion: string,
    predictionTimestamp: number,
    actualOutcome: any
  ): Promise<void> {
    const predictions = await this.storage.getPredictions(modelId, modelVersion, 1000);
    
    const prediction = predictions.find(p => p.timestamp === predictionTimestamp);
    if (prediction) {
      prediction.actualOutcome = actualOutcome;
      await this.storage.storePrediction(prediction);
    }
  }
  
  /**
   * Calculate performance metrics for a model
   */
  async calculateMetrics(
    modelId: string,
    modelVersion: string,
    predictionType: 'classification' | 'regression'
  ): Promise<ModelPerformanceMetrics> {
    const predictions = await this.storage.getPredictions(modelId, modelVersion, 1000);
    const predictionsWithOutcomes = predictions.filter(p => p.actualOutcome !== undefined);
    
    if (predictionsWithOutcomes.length === 0) {
      throw new Error('No predictions with outcomes available');
    }
    
    const metrics: ModelPerformanceMetrics = {
      modelId,
      modelVersion,
      timestamp: Date.now(),
      averageLatency: this.calculateAverageLatency(predictions),
      throughput: this.calculateThroughput(predictions),
      errorRate: this.calculateErrorRate(predictions)
    };
    
    if (predictionType === 'classification') {
      Object.assign(metrics, this.calculateClassificationMetrics(predictionsWithOutcomes));
    } else {
      Object.assign(metrics, this.calculateRegressionMetrics(predictionsWithOutcomes));
    }
    
    await this.storage.storePerformanceMetrics(metrics);
    return metrics;
  }
  
  private calculateAverageLatency(predictions: PredictionRecord[]): number {
    const latencies = predictions.map(p => p.executionTime);
    return latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
  }
  
  private calculateThroughput(predictions: PredictionRecord[]): number {
    if (predictions.length < 2) return 0;
    
    const timeSpan = predictions[predictions.length - 1].timestamp - predictions[0].timestamp;
    return predictions.length / (timeSpan / 1000); // predictions per second
  }
  
  private calculateErrorRate(predictions: PredictionRecord[]): number {
    const errors = predictions.filter(p => p.prediction === null || p.prediction === undefined);
    return errors.length / predictions.length;
  }
  
  private calculateClassificationMetrics(predictions: PredictionRecord[]): Partial<ModelPerformanceMetrics> {
    const correct = predictions.filter(p => p.prediction === p.actualOutcome).length;
    const total = predictions.length;
    
    const accuracy = correct / total;
    
    // Calculate precision, recall, F1 (simplified)
    const truePositives = predictions.filter(p => p.prediction === 1 && p.actualOutcome === 1).length;
    const falsePositives = predictions.filter(p => p.prediction === 1 && p.actualOutcome === 0).length;
    const falseNegatives = predictions.filter(p => p.prediction === 0 && p.actualOutcome === 1).length;
    
    const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
    const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;
    const f1Score = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    
    return {
      accuracy,
      precision,
      recall,
      f1Score
    };
  }
  
  private calculateRegressionMetrics(predictions: PredictionRecord[]): Partial<ModelPerformanceMetrics> {
    const errors = predictions.map(p => (p.prediction - p.actualOutcome) ** 2);
    const absoluteErrors = predictions.map(p => Math.abs(p.prediction - p.actualOutcome));
    
    const mse = errors.reduce((sum, err) => sum + err, 0) / errors.length;
    const rmse = Math.sqrt(mse);
    const mae = absoluteErrors.reduce((sum, err) => sum + err, 0) / absoluteErrors.length;
    
    // Calculate R²
    const meanOutcome = predictions.reduce((sum, p) => sum + p.actualOutcome, 0) / predictions.length;
    const totalSumSquares = predictions.reduce((sum, p) => sum + (p.actualOutcome - meanOutcome) ** 2, 0);
    const residualSumSquares = errors.reduce((sum, err) => sum + err, 0);
    const r2Score = 1 - (residualSumSquares / totalSumSquares);
    
    return {
      mse,
      rmse,
      mae,
      r2Score
    };
  }
}

// --- Drift Detector ---

export class DriftDetector {
  private storage: MonitoringStorage;
  
  constructor(storage: MonitoringStorage) {
    this.storage = storage;
  }
  
  /**
   * Detect drift in model performance and data distribution
   */
  async detectDrift(
    modelId: string,
    modelVersion: string,
    currentFeatures: any[],
    trainingFeatures: any[]
  ): Promise<DriftDetectionResult> {
    const result: DriftDetectionResult = {
      timestamp: Date.now(),
      modelId,
      modelVersion,
      featureDrift: {
        detected: false,
        severity: 'low',
        driftedFeatures: [],
        klDivergence: 0
      },
      conceptDrift: {
        detected: false,
        severity: 'low',
        performanceDegradation: 0
      },
      dataDrift: {
        detected: false,
        severity: 'low',
        statisticalTests: []
      },
      recommendation: 'no_action'
    };
    
    // Detect feature drift
    result.featureDrift = await this.detectFeatureDrift(currentFeatures, trainingFeatures);
    
    // Detect concept drift
    result.conceptDrift = await this.detectConceptDrift(modelId, modelVersion);
    
    // Detect data drift
    result.dataDrift = await this.detectDataDrift(currentFeatures, trainingFeatures);
    
    // Generate recommendation
    result.recommendation = this.generateDriftRecommendation(result);
    
    return result;
  }
  
  private async detectFeatureDrift(
    currentFeatures: any[],
    trainingFeatures: any[]
  ): Promise<DriftDetectionResult['featureDrift']> {
    // Simplified feature drift detection using KL divergence
    const driftedFeatures: string[] = [];
    let totalKLDivergence = 0;
    
    // In production, this would calculate actual statistical distances
    // For now, use a simplified approach
    for (let i = 0; i < Math.min(currentFeatures[0].length, 10); i++) {
      const currentValues = currentFeatures.map(f => f[i]);
      const trainingValues = trainingFeatures.map(f => f[i]);
      
      const klDivergence = this.calculateKLDivergence(currentValues, trainingValues);
      totalKLDivergence += klDivergence;
      
      if (klDivergence > 0.1) { // Threshold for drift
        driftedFeatures.push(`feature_${i}`);
      }
    }
    
    const detected = driftedFeatures.length > 0;
    const severity = driftedFeatures.length > 5 ? 'high' : driftedFeatures.length > 2 ? 'medium' : 'low';
    
    return {
      detected,
      severity,
      driftedFeatures,
      klDivergence: totalKLDivergence
    };
  }
  
  private async detectConceptDrift(
    modelId: string,
    modelVersion: string
  ): Promise<DriftDetectionResult['conceptDrift']> {
    const recentMetrics = await this.storage.getPerformanceMetrics(modelId, modelVersion, 10);
    
    if (recentMetrics.length < 2) {
      return {
        detected: false,
        severity: 'low',
        performanceDegradation: 0
      };
    }
    
    const latestMetric = recentMetrics[recentMetrics.length - 1];
    const baselineMetric = recentMetrics[0];
    
    // Compare performance degradation
    const accuracyChange = (latestMetric.accuracy || 0) - (baselineMetric.accuracy || 0);
    const performanceDegradation = Math.abs(accuracyChange);
    
    const detected = performanceDegradation > 0.1; // 10% degradation threshold
    const severity = performanceDegradation > 0.3 ? 'high' : performanceDegradation > 0.15 ? 'medium' : 'low';
    
    return {
      detected,
      severity,
      performanceDegradation
    };
  }
  
  private async detectDataDrift(
    currentFeatures: any[],
    trainingFeatures: any[]
  ): Promise<DriftDetectionResult['dataDrift']> {
    const statisticalTests: string[] = [];
    
    // In production, this would run actual statistical tests
    // For now, use simplified checks
    const currentMean = this.calculateMean(currentFeatures);
    const trainingMean = this.calculateMean(trainingFeatures);
    
    const meanDifference = Math.abs(currentMean - trainingMean) / trainingMean;
    
    if (meanDifference > 0.2) {
      statisticalTests.push('mean_shift_detected');
    }
    
    const currentStd = this.calculateStd(currentFeatures);
    const trainingStd = this.calculateStd(trainingFeatures);
    
    const stdDifference = Math.abs(currentStd - trainingStd) / trainingStd;
    
    if (stdDifference > 0.2) {
      statisticalTests.push('variance_shift_detected');
    }
    
    const detected = statisticalTests.length > 0;
    const severity = statisticalTests.length > 2 ? 'high' : statisticalTests.length > 1 ? 'medium' : 'low';
    
    return {
      detected,
      severity,
      statisticalTests
    };
  }
  
  private calculateKLDivergence(p: number[], q: number[]): number {
    // Simplified KL divergence calculation
    const pNorm = p.map(v => v / p.reduce((sum, v) => sum + v, 0));
    const qNorm = q.map(v => v / q.reduce((sum, v) => sum + v, 0));
    
    let klDiv = 0;
    for (let i = 0; i < pNorm.length; i++) {
      if (pNorm[i] > 0 && qNorm[i] > 0) {
        klDiv += pNorm[i] * Math.log(pNorm[i] / qNorm[i]);
      }
    }
    
    return klDiv;
  }
  
  private calculateMean(features: any[]): number {
    const flat = features.flat();
    return flat.reduce((sum, val) => sum + Number(val), 0) / flat.length;
  }
  
  private calculateStd(features: any[]): number {
    const flat = features.map(f => Number(f)).flat();
    const mean = flat.reduce((sum, val) => sum + val, 0) / flat.length;
    const variance = flat.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / flat.length;
    return Math.sqrt(variance);
  }
  
  private generateDriftRecommendation(result: DriftDetectionResult): 'no_action' | 'monitor' | 'retrain' | 'emergency_retrain' {
    const driftDetected = result.featureDrift.detected || result.conceptDrift.detected || result.dataDrift.detected;
    
    if (!driftDetected) {
      return 'no_action';
    }
    
    const highSeverityDrift = 
      result.featureDrift.severity === 'high' ||
      result.conceptDrift.severity === 'high' ||
      result.dataDrift.severity === 'high';
    
    const mediumSeverityDrift = 
      result.featureDrift.severity === 'medium' ||
      result.conceptDrift.severity === 'medium' ||
      result.dataDrift.severity === 'medium';
    
    if (highSeverityDrift) {
      return 'emergency_retrain';
    }
    
    if (mediumSeverityDrift) {
      return 'retrain';
    }
    
    return 'monitor';
  }
}

// --- Model Health Monitor ---

export class ModelHealthMonitor {
  private storage: MonitoringStorage;
  private performanceTracker: PerformanceTracker;
  private driftDetector: DriftDetector;
  
  constructor(storage: MonitoringStorage) {
    this.storage = storage;
    this.performanceTracker = new PerformanceTracker(storage);
    this.driftDetector = new DriftDetector(storage);
  }
  
  /**
   * Get overall health status for a model
   */
  async getHealthStatus(
    modelId: string,
    modelVersion: string,
    currentFeatures: any[],
    trainingFeatures: any[]
  ): Promise<ModelHealthStatus> {
    const status: ModelHealthStatus = {
      modelId,
      modelVersion,
      timestamp: Date.now(),
      status: 'healthy',
      overallHealthScore: 100,
      performanceScore: 100,
      driftScore: 100,
      operationalScore: 100,
      alerts: [],
      recommendations: []
    };
    
    // Check performance
    try {
      const metrics = await this.performanceTracker.calculateMetrics(modelId, modelVersion, 'classification');
      status.performanceScore = this.calculatePerformanceScore(metrics);
      
      if (status.performanceScore < 70) {
        status.alerts.push({
          timestamp: Date.now(),
          severity: 'warning',
          type: 'performance_degradation',
          message: `Performance score is ${status.performanceScore.toFixed(0)}/100`
        });
      }
    } catch (error) {
      status.performanceScore = 50;
      status.alerts.push({
        timestamp: Date.now(),
        severity: 'critical',
        type: 'performance_error',
        message: 'Unable to calculate performance metrics'
      });
    }
    
    // Check drift
    try {
      const driftResult = await this.driftDetector.detectDrift(modelId, modelVersion, currentFeatures, trainingFeatures);
      status.driftScore = this.calculateDriftScore(driftResult);
      
      if (driftResult.recommendation !== 'no_action') {
        status.alerts.push({
          timestamp: Date.now(),
          severity: driftResult.recommendation === 'emergency_retrain' ? 'critical' : 'warning',
          type: 'drift_detected',
          message: `Drift detected: ${driftResult.recommendation}`,
          details: driftResult
        });
      }
    } catch (error) {
      status.driftScore = 50;
      status.alerts.push({
        timestamp: Date.now(),
        severity: 'warning',
        type: 'drift_error',
        message: 'Unable to detect drift'
      });
    }
    
    // Check operational health
    const recentPredictions = await this.storage.getPredictions(modelId, modelVersion, 100);
    status.operationalScore = this.calculateOperationalScore(recentPredictions);
    
    if (status.operationalScore < 70) {
      status.alerts.push({
        timestamp: Date.now(),
        severity: 'warning',
        type: 'operational_issue',
        message: `Operational score is ${status.operationalScore.toFixed(0)}/100`
      });
    }
    
    // Calculate overall health
    status.overallHealthScore = (status.performanceScore + status.driftScore + status.operationalScore) / 3;
    
    // Determine status
    if (status.overallHealthScore >= 80) {
      status.status = 'healthy';
    } else if (status.overallHealthScore >= 50) {
      status.status = 'degraded';
    } else {
      status.status = 'critical';
    }
    
    // Generate recommendations
    status.recommendations = this.generateRecommendations(status);
    
    return status;
  }
  
  private calculatePerformanceScore(metrics: ModelPerformanceMetrics): number {
    let score = 100;
    
    // Deduct points for poor accuracy
    if (metrics.accuracy !== undefined) {
      score -= (1 - metrics.accuracy) * 50;
    }
    
    // Deduct points for high error rate
    score -= metrics.errorRate * 30;
    
    // Deduct points for high latency
    if (metrics.averageLatency > 100) { // > 100ms
      score -= (metrics.averageLatency - 100) / 10;
    }
    
    return Math.max(0, Math.min(100, score));
  }
  
  private calculateDriftScore(driftResult: DriftDetectionResult): number {
    let score = 100;
    
    if (driftResult.featureDrift.detected) {
      const severityPenalty = driftResult.featureDrift.severity === 'high' ? 30 : 
                            driftResult.featureDrift.severity === 'medium' ? 15 : 5;
      score -= severityPenalty;
    }
    
    if (driftResult.conceptDrift.detected) {
      const severityPenalty = driftResult.conceptDrift.severity === 'high' ? 30 : 
                            driftResult.conceptDrift.severity === 'medium' ? 15 : 5;
      score -= severityPenalty;
    }
    
    if (driftResult.dataDrift.detected) {
      const severityPenalty = driftResult.dataDrift.severity === 'high' ? 20 : 
                            driftResult.dataDrift.severity === 'medium' ? 10 : 5;
      score -= severityPenalty;
    }
    
    return Math.max(0, Math.min(100, score));
  }
  
  private calculateOperationalScore(predictions: PredictionRecord[]): number {
    if (predictions.length === 0) return 100;
    
    let score = 100;
    
    // Check error rate
    const errors = predictions.filter(p => p.prediction === null || p.prediction === undefined);
    const errorRate = errors.length / predictions.length;
    score -= errorRate * 50;
    
    // Check average confidence
    const avgConfidence = predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;
    if (avgConfidence < 0.7) {
      score -= (0.7 - avgConfidence) * 50;
    }
    
    return Math.max(0, Math.min(100, score));
  }
  
  private generateRecommendations(status: ModelHealthStatus): string[] {
    const recommendations: string[] = [];
    
    if (status.status === 'critical') {
      recommendations.push('URGENT: Model requires immediate attention');
      recommendations.push('Consider rolling back to previous model version');
      recommendations.push('Review recent data for anomalies');
    }
    
    if (status.performanceScore < 70) {
      recommendations.push('Review model performance metrics');
      recommendations.push('Consider retraining with recent data');
    }
    
    if (status.driftScore < 70) {
      recommendations.push('Investigate feature drift');
      recommendations.push('Update training data if distribution has changed');
    }
    
    if (status.operationalScore < 70) {
      recommendations.push('Review prediction latency');
      recommendations.push('Check for system errors');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Model is healthy - continue monitoring');
    }
    
    return recommendations;
  }
}