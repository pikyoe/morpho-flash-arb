# Machine Learning Integration Guide

## Overview

This document provides comprehensive guidance for integrating and using the machine learning components in the flash loan arbitrage bot. The ML system enhances decision-making through predictive analytics, pattern recognition, and automated learning.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Quick Start](#quick-start)
3. [Feature Engineering](#feature-engineering)
4. [Model Training](#model-training)
5. [Prediction Service](#prediction-service)
6. [Bot Integration](#bot-integration)
7. [Backtesting](#backtesting)
8. [Model Monitoring](#model-monitoring)
9. [Configuration](#configuration)
10. [Troubleshooting](#troubleshooting)

## Architecture Overview

### ML Pipeline Components

```
Raw Data → Feature Engineering → Model Training → Model Registry → Prediction Service → Bot Integration
                ↓                    ↓                  ↓                  ↓                  ↓
         Feature Store        Training Pipeline    Model Files      Inference API      Decision Engine
```

### Key Components

1. **Feature Engineering** (`bot/ml/features.ts`)
   - Extracts features from on-chain and off-chain data
   - Computes position, market, network, competition, and temporal features
   - Normalizes and transforms features for ML consumption

2. **Model Training** (`bot/ml/train_models.py`)
   - Python-based training pipeline
   - Trains multiple models (liquidation, profitability, competition)
   - Performs hyperparameter tuning and evaluation
   - Exports models for TypeScript integration

3. **Prediction Service** (`bot/ml/prediction-service.ts`)
   - TypeScript-based inference service
   - Loads trained models and provides real-time predictions
   - Generates comprehensive opportunity assessments
   - Supports batch prediction for efficiency

4. **Bot Integration** (`bot/ml-enhanced-watch.ts`)
   - Enhanced watch bot with ML integration
   - Uses ML predictions for decision making
   - Implements ML-based timing and position sizing
   - Maintains backward compatibility with traditional methods

5. **Backtesting Framework** (`bot/ml/backtesting.ts`)
   - Historical simulation of ML-enhanced strategies
   - Performance evaluation and comparison
   - Risk analysis and metrics calculation

6. **Model Monitoring** (`bot/ml/model-monitoring.ts`)
   - Real-time performance tracking
   - Drift detection and alerting
   - Automated retraining triggers
   - Health status monitoring

## Quick Start

### Prerequisites

```bash
# Python dependencies for model training
pip install pandas numpy scikit-learn joblib

# Node.js dependencies are already in package.json
npm install
```

### Step 1: Train Models

```bash
# Navigate to the bot directory
cd bot

# Run the training pipeline
python3 ml/train_models.py
```

This will:
- Generate sample training data
- Train liquidation, profitability, and competition models
- Evaluate model performance
- Export models to `./exported_models/`

### Step 2: Configure ML Integration

Add ML configuration to your `.env` file:

```bash
# ML Configuration
ML_ENABLED=true
ML_MIN_CONFIDENCE=0.7
ML_MIN_OVERALL_SCORE=0.6
ML_USE_TIMING=true
ML_USE_POSITION_SIZING=true
```

### Step 3: Run ML-Enhanced Bot

```bash
# Run the ML-enhanced watch bot
npm run ml-watch

# Or run with live execution
LIVE_EXECUTION=true npm run ml-watch
```

## Feature Engineering

### Feature Categories

#### Position Features
- **Health Factor**: Current health factor of the position
- **Collateral/Debt USD**: Total collateral and debt values
- **Concentration Metrics**: Asset concentration using Herfindahl-Hirschman Index
- **Position Age**: Time since position was opened
- **Asset Volatility**: Historical volatility of position assets

#### Market Features
- **Price Changes**: 24h and 1h price changes
- **Volatility**: Historical and implied volatility
- **Liquidity**: Depth, changes, and slippage estimates
- **Market Structure**: Market cap, trading volume
- **Correlations**: Cross-asset correlations and beta

#### Network Features
- **Gas Metrics**: Current gas price, historical changes, percentiles
- **Block Metrics**: Block time, utilization, pending transactions
- **Mempool**: Size, congestion, pending arbitrage transactions
- **Network Health**: TPS, network status classification

#### Competition Features
- **MEV Bot Activity**: Bot count, activity levels
- **Competition Metrics**: Intensity, expected competitors, win probability
- **Risk Metrics**: Front-run rate, sandwich rate
- **Timing**: Optimal execution time, priority fee estimates

#### Temporal Features
- **Time Features**: Hour of day, day of week, weekend flag
- **Seasonal Features**: Month, quarter, quarter-end flag
- **Market Session**: Asia, Europe, US, overlap sessions
- **Special Events**: Holidays, earnings season, option expiry

### Feature Engineering Usage

```typescript
import { FeatureEngineer } from './ml/features.js';

const featureEngineer = new FeatureEngineer(provider);

// Compute all features for an opportunity
const features = await featureEngineer.computeAllFeatures(
  userAddress,
  collateral,
  debt,
  healthFactor,
  prices,
  asset,
  currentPrice,
  historicalPrices
);

// Get feature vector for ML models
const featureVector = features.toFeatureVector();
```

## Model Training

### Training Pipeline

The training pipeline (`train_models.py`) handles:

1. **Data Preparation**
   - Loading historical data
   - Feature engineering
   - Class balancing
   - Train/validation/test splits

2. **Model Training**
   - Liquidation probability classification
   - Profitability regression
   - Competition intensity classification
   - Ensemble model training

3. **Model Evaluation**
   - Classification metrics (accuracy, precision, recall, F1)
   - Regression metrics (MSE, RMSE, R²)
   - Cross-validation
   - Feature importance analysis

4. **Model Export**
   - Export to joblib format
   - Metadata generation
   - Evaluation results export

### Custom Training

To train with your own data:

```python
from ml.train_models import DataPreparer, ModelTrainer, ModelEvaluator, ModelExporter

# Load your data
data_preparer = DataPreparer(data_path="/path/to/your/data")
raw_data = data_preparer.load_historical_data()

# Engineer features
engineered_data = data_preparer.engineer_features(raw_data)

# Train models
model_trainer = ModelTrainer()
model = model_trainer.train_liquidation_model(X_train, y_train)

# Evaluate
evaluator = ModelEvaluator()
results = evaluator.evaluate_classification(model, X_test, y_test)

# Export
exporter = ModelExporter()
exporter.export_model(model, 'custom_model')
```

### Hyperparameter Tuning

The training pipeline includes automatic hyperparameter tuning using GridSearchCV:

```python
param_grid = {
    'n_estimators': [50, 100, 200],
    'learning_rate': [0.01, 0.1, 0.2],
    'max_depth': [3, 5, 7]
}

grid_search = GridSearchCV(model, param_grid, cv=5, scoring='f1')
grid_search.fit(X_train, y_train)
```

## Prediction Service

### Using the Prediction Service

```typescript
import { PredictionService } from './ml/prediction-service.js';

const predictionService = new PredictionService(provider);
await predictionService.loadModels();

// Predict liquidation probability
const liquidationPrediction = await predictionService.predictLiquidation(
  userAddress,
  collateral,
  debt,
  healthFactor,
  prices
);

// Predict profitability
const profitabilityPrediction = await predictionService.predictProfitability(
  route,
  currentPrices,
  marketConditions
);

// Predict competition
const competitionPrediction = await predictionService.predictCompetition(
  mempoolData
);

// Get comprehensive opportunity prediction
const opportunityPrediction = await predictionService.predictOpportunity(
  userAddress,
  collateral,
  debt,
  healthFactor,
  prices,
  route
);
```

### Prediction Interpretation

#### Liquidation Prediction
```typescript
{
  probability: 0.85,        // 85% chance of liquidation
  confidence: 0.92,         // High confidence in prediction
  timeframe: 12,             // Hours until likely liquidation
  riskLevel: 'high',         // Risk classification
  features: {
    healthFactorContribution: 0.6,
    marketContribution: 0.2,
    networkContribution: 0.2
  }
}
```

#### Profitability Prediction
```typescript
{
  expectedProfit: 75.50,     // Expected profit in USD
  confidence: 0.78,         // Prediction confidence
  riskAdjustedProfit: 65.20, // Profit adjusted for risk
  profitRange: { min: 52.85, max: 98.15 },
  probabilityOfProfit: 0.85, // 85% chance of profit
  features: {
    liquidityContribution: 0.4,
    competitionContribution: 0.3,
    timingContribution: 0.3
  }
}
```

#### Competition Prediction
```typescript
{
  intensity: 0.65,           // Competition intensity (0-1)
  expectedCompetitors: 6,    // Expected number of competitors
  winProbability: 0.45,      // 45% chance of winning
  frontRunRisk: 0.35,        // 35% front-run risk
  sandwichRisk: 0.25,        // 25% sandwich risk
  recommendedPriorityFee: 2.5, // Recommended priority fee (gwei)
  optimalTiming: 1699123456789, // Optimal execution timestamp
  features: {
    mempoolContribution: 0.4,
    gasPriceContribution: 0.3,
    historicalContribution: 0.3
  }
}
```

### Batch Predictions

For efficiency, use batch predictions:

```typescript
// Batch liquidation predictions
const positions = [...]; // Array of position data
const liquidationPredictions = await predictionService.batchPredictLiquidation(positions);

// Batch profitability predictions
const routes = [...]; // Array of route data
const profitabilityPredictions = await predictionService.batchPredictProfitability(routes);
```

## Bot Integration

### ML-Enhanced Watch Bot

The ML-enhanced watch bot (`ml-enhanced-watch.ts`) integrates ML predictions into the arbitrage decision process:

#### Enhanced Decision Flow

```
Traditional Evaluation → ML Predictions → Combined Score → Final Decision
                        ↓                    ↓                  ↓
                Confidence Check      Score Threshold    Execute/Skip/Wait
                Risk Adjustment       Win Probability   Priority Fee
                Timing Recommendation Competition Level
```

#### ML Configuration Options

```bash
# Enable/disable ML
ML_ENABLED=true

# Minimum confidence to act on ML predictions
ML_MIN_CONFIDENCE=0.7

# Minimum overall ML score to proceed
ML_MIN_OVERALL_SCORE=0.6

# Use ML timing recommendations
ML_USE_TIMING=true

# Use ML for position sizing
ML_USE_POSITION_SIZING=true
```

#### Running the ML-Enhanced Bot

```bash
# Dry run with ML
npm run ml-watch

# Live execution with ML
LIVE_EXECUTION=true npm run ml-watch

# With custom ML configuration
ML_ENABLED=true ML_MIN_CONFIDENCE=0.8 npm run ml-watch
```

### Custom Integration

To integrate ML predictions into your own bot:

```typescript
import { PredictionService } from './ml/prediction-service.js';

class CustomBot {
  private predictionService: PredictionService;
  
  constructor(provider) {
    this.predictionService = new PredictionService(provider);
    await this.predictionService.loadModels();
  }
  
  async evaluateOpportunity(opportunity) {
    // Get ML prediction
    const mlPrediction = await this.predictionService.predictOpportunity(
      opportunity.userAddress,
      opportunity.collateral,
      opportunity.debt,
      opportunity.healthFactor,
      opportunity.prices,
      opportunity.route
    );
    
    // Combine with your own logic
    const traditionalScore = this.calculateTraditionalScore(opportunity);
    const mlScore = mlPrediction.overallScore;
    
    // Make decision
    if (mlPrediction.confidence > 0.7 && mlScore > 0.6) {
      return { execute: true, reasoning: mlPrediction.reasoning };
    }
    
    return { execute: false, reasoning: 'ML score below threshold' };
  }
}
```

## Backtesting

### Running Backtests

```typescript
import { Backtester } from './ml/backtesting.js';

const backtester = new Backtester(provider);

const config = {
  startDate: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
  endDate: Date.now(),
  initialCapital: 10000,
  maxPositionSize: 1000,
  minProfitThreshold: 10,
  useMLPredictions: true,
  useMLTiming: true,
  useMLPositionSizing: true,
  mlConfidenceThreshold: 0.7,
  mlScoreThreshold: 0.6
};

// Load historical data
const historicalData = await backtester.loadHistoricalData(config);

// Run backtest
const results = await backtester.runBacktest(historicalData, config);

// Analyze results
const summary = backtester.analyzeResults(results);

// Generate report
console.log(backtester.generateReport(summary));
```

### Backtest Metrics

The backtesting framework provides:

- **Financial Metrics**: Total profit/loss, average profit, win rate, profit factor
- **Risk Metrics**: Sharpe ratio, maximum drawdown, risk-adjusted returns
- **ML Improvement**: Profit improvement, win rate improvement, loss reduction
- **Operational Metrics**: Execution latency, prediction accuracy

### Sample Backtest Report

```
=== BACKTEST REPORT ===

Opportunity Analysis:
  Total Opportunities: 150
  Executed: 45 (30.0%)
  Skipped: 105 (70.0%)
  ML-Enhanced: 45 (30.0%)

Financial Performance:
  Total Profit: $2,345.67
  Total Loss: $456.78
  Net Profit: $1,888.89
  Average Profit: $52.35
  Max Profit: $234.56
  Max Loss: -$89.12

Risk Metrics:
  Win Rate: 78.5%
  Profit Factor: 5.13
  Sharpe Ratio: 2.45
  Max Drawdown: $234.56

ML Enhancement Impact:
  Profit Improvement: 23.5%
  Win Rate Improvement: 15.2%
  Loss Reduction: 18.7%

Operational Metrics:
  Execution Latency: 45ms
  Prediction Accuracy: 82.3%
```

## Model Monitoring

### Monitoring Setup

```typescript
import { ModelHealthMonitor, MonitoringStorage } from './ml/model-monitoring.js';

const storage = new MonitoringStorage();
const healthMonitor = new ModelHealthMonitor(storage);

// Get health status
const healthStatus = await healthMonitor.getHealthStatus(
  'liquidation_model',
  '1.0',
  currentFeatures,
  trainingFeatures
);

console.log(`Model Status: ${healthStatus.status}`);
console.log(`Health Score: ${healthStatus.overallHealthScore}`);
console.log(`Alerts: ${healthStatus.alerts.length}`);
console.log(`Recommendations: ${healthStatus.recommendations.join(', ')}`);
```

### Health Status Interpretation

- **Healthy (80-100)**: Model performing well, no action needed
- **Degraded (50-79)**: Some performance issues, monitor closely
- **Critical (0-49)**: Immediate attention required, consider retraining

### Automated Monitoring

Set up automated monitoring with periodic checks:

```typescript
async function runMonitoringLoop() {
  const storage = new MonitoringStorage();
  const healthMonitor = new ModelHealthMonitor(storage);
  
  setInterval(async () => {
    const healthStatus = await healthMonitor.getHealthStatus(
      'liquidation_model',
      '1.0',
      currentFeatures,
      trainingFeatures
    );
    
    if (healthStatus.status === 'critical') {
      // Send alert
      await sendAlert(healthStatus);
      
      // Trigger retraining if needed
      if (healthStatus.recommendations.includes('retrain')) {
        await triggerRetraining();
      }
    }
  }, 3600000); // Check every hour
}
```

## Configuration

### Environment Variables

```bash
# ML Configuration
ML_ENABLED=true                          # Enable/disable ML features
ML_MIN_CONFIDENCE=0.7                    # Minimum confidence threshold
ML_MIN_OVERALL_SCORE=0.6                  # Minimum overall score threshold
ML_USE_TIMING=true                        # Use ML timing recommendations
ML_USE_POSITION_SIZING=true              # Use ML for position sizing

# Model Configuration
MODEL_PATH=./exported_models/            # Path to exported models
MODEL_VERSION=1.0                        # Current model version

# Training Configuration
TRAINING_DATA_PATH=./data/               # Path to training data
FEATURE_STORE_PATH=./features/            # Path to feature store

# Monitoring Configuration
MONITORING_ENABLED=true                   # Enable model monitoring
HEALTH_CHECK_INTERVAL=3600000            # Health check interval (ms)
DRIFT_DETECTION_ENABLED=true              # Enable drift detection
```

### Model Registry

Track model versions and metadata:

```typescript
import { ModelManager } from './ml/prediction-service.js';

const modelManager = new ModelManager();

// Register a model
await modelManager.registerModel('liquidation_model', model, '1.0');

// List models
const models = modelManager.listModels();
console.log('Registered models:', models);

// Get model version
const version = modelManager.getModelVersion('liquidation_model');

// Update model
await modelManager.updateModel('liquidation_model', newModel, '1.1');

// Rollback if needed
await modelManager.rollbackModel('liquidation_model', '1.0');
```

## Troubleshooting

### Common Issues

#### Model Loading Errors

**Problem**: Model fails to load
```
Error loading ML models: Error: Cannot find module './exported_models/liquidation_model.joblib'
```

**Solution**: 
1. Train models first: `python3 bot/ml/train_models.py`
2. Check model path in configuration
3. Ensure model files exist in the expected location

#### Prediction Errors

**Problem**: Predictions return unexpected values
```
ML prediction failed: TypeError: Cannot read property 'probability' of undefined
```

**Solution**:
1. Verify feature extraction is working correctly
2. Check model input format matches training data
3. Ensure model is properly loaded
4. Review prediction service logs for detailed errors

#### Performance Issues

**Problem**: ML predictions are slow
```
ML predictions taking >500ms, affecting bot performance
```

**Solution**:
1. Use batch predictions instead of single predictions
2. Enable model caching
3. Consider using simpler models for faster inference
4. Optimize feature extraction

#### Memory Issues

**Problem**: Bot runs out of memory with ML enabled
```
JavaScript heap out of memory
```

**Solution**:
1. Reduce feature vector size
2. Use streaming for large datasets
3. Increase Node.js memory limit: `NODE_OPTIONS="--max-old-space-size=4096"`
4. Process predictions in batches

### Debug Mode

Enable debug logging for ML components:

```bash
# Enable debug logging
DEBUG=ml:* npm run ml-watch

# Increase logging verbosity
LOG_LEVEL=debug npm run ml-watch
```

### Model Performance Issues

**Problem**: Model accuracy degrades over time

**Solution**:
1. Check for data drift using monitoring tools
2. Retrain models with recent data
3. Review feature engineering for relevance
4. Consider ensemble methods for robustness

## Best Practices

### Model Training

1. **Data Quality**: Ensure training data is clean and representative
2. **Feature Selection**: Use only relevant features to avoid overfitting
3. **Cross-Validation**: Always use cross-validation for reliable evaluation
4. **Regular Updates**: Retrain models regularly with fresh data
5. **Version Control**: Keep track of model versions and performance

### Production Deployment

1. **Gradual Rollout**: Start with dry-run mode before live execution
2. **A/B Testing**: Compare ML-enhanced vs traditional approaches
3. **Monitoring**: Set up comprehensive monitoring and alerting
4. **Fallback**: Maintain ability to fall back to traditional methods
5. **Documentation**: Document model performance and decision rationale

### Risk Management

1. **Confidence Thresholds**: Use appropriate confidence thresholds
2. **Position Sizing**: Adjust position sizes based on prediction confidence
3. **Diversification**: Don't rely solely on ML predictions
4. **Human Oversight**: Maintain human oversight for critical decisions
5. **Regular Reviews**: Regularly review model performance and predictions

## Advanced Topics

### Custom Model Development

To develop custom models:

1. **Define Features**: Identify relevant features for your use case
2. **Collect Data**: Gather historical data for training
3. **Train Models**: Use the training pipeline or custom training
4. **Evaluate Performance**: Test thoroughly with backtesting
5. **Deploy Integration**: Integrate with the prediction service

### Ensemble Methods

Combine multiple models for better performance:

```python
from sklearn.ensemble import StackingClassifier, VotingClassifier

# Stacking ensemble
stacking_model = StackingClassifier(
    estimators=[
        ('rf', RandomForestClassifier()),
        ('gb', GradientBoostingClassifier()),
        ('lr', LogisticRegression())
    ],
    final_estimator=GradientBoostingClassifier()
)

# Voting ensemble
voting_model = VotingClassifier(
    estimators=[
        ('rf', RandomForestClassifier()),
        ('gb', GradientBoostingClassifier())
    ],
    voting='soft'
)
```

### Real-Time Learning

Implement online learning for continuous improvement:

```python
from sklearn.linear_model import SGDClassifier

# Online learning model
online_model = SGDClassifier(warm_start=True)

# Update with new data
online_model.partial_fit(X_new, y_new, classes=[0, 1])
```

## Support and Resources

### Documentation
- [ML Architecture](./bot/ml/architecture.md) - Detailed ML architecture documentation
- [Feature Engineering Guide](./bot/ml/features.ts) - Feature engineering implementation
- [Training Pipeline](./bot/ml/train_models.py) - Model training implementation

### Community
- GitHub Issues: Report bugs and request features
- Discord/Slack: Join community discussions
- Documentation: Contribute improvements

### Professional Services
For production deployment and custom ML development, consider:
- Professional ML consulting
- Custom model development
- Production ML infrastructure
- Ongoing support and maintenance

## License

This ML integration is provided as part of the flash loan arbitrage project. See the main project LICENSE file for details.