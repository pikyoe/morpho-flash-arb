"""
ML Model Training Pipeline for Flash Loan Arbitrage

This script provides a comprehensive training pipeline for various ML models
used in the arbitrage bot, including data preparation, model training,
evaluation, and export to formats compatible with the TypeScript bot.
"""

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor, GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import classification_report, confusion_matrix, mean_squared_error, r2_score
import joblib
import json
from datetime import datetime, timedelta
import logging
from typing import Dict, List, Tuple, Any
import os

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('training.log')
    ]
)
logger = logging.getLogger(__name__)

class DataPreparer:
    """Prepares data for ML model training"""
    
    def __init__(self, data_path: str = "./data/"):
        self.data_path = data_path
        self.scaler = StandardScaler()
        self.scalers = {}  # Store separate scalers for different models
        
    def load_historical_data(self) -> pd.DataFrame:
        """Load historical arbitrage data"""
        try:
            # In production, this would load from database or files
            # For now, create sample data structure
            data = self._create_sample_data()
            logger.info(f"Loaded {len(data)} historical records")
            return data
        except Exception as e:
            logger.error(f"Error loading historical data: {e}")
            raise
    
    def _create_sample_data(self) -> pd.DataFrame:
        """Create sample data for demonstration"""
        np.random.seed(42)
        n_samples = 10000
        
        data = {
            # Position features
            'health_factor': np.random.uniform(0.5, 2.0, n_samples),
            'collateral_usd': np.random.uniform(1000, 100000, n_samples),
            'debt_usd': np.random.uniform(500, 50000, n_samples),
            'collateral_count': np.random.randint(1, 5, n_samples),
            'collateral_concentration': np.random.uniform(0.2, 1.0, n_samples),
            'top_collateral_pct': np.random.uniform(0.3, 1.0, n_samples),
            'debt_count': np.random.randint(1, 3, n_samples),
            'debt_concentration': np.random.uniform(0.3, 1.0, n_samples),
            'top_debt_pct': np.random.uniform(0.5, 1.0, n_samples),
            'collateral_to_debt_ratio': np.random.uniform(1.0, 5.0, n_samples),
            'distance_to_liquidation': np.random.uniform(-0.5, 1.0, n_samples),
            'position_age': np.random.uniform(1, 720, n_samples),
            
            # Market features
            'price_change_24h': np.random.uniform(-10, 10, n_samples),
            'price_change_1h': np.random.uniform(-2, 2, n_samples),
            'price_volatility_24h': np.random.uniform(0.1, 1.0, n_samples),
            'price_volatility_1h': np.random.uniform(0.05, 0.5, n_samples),
            'liquidity_depth': np.random.uniform(10000, 1000000, n_samples),
            'liquidity_24h_change': np.random.uniform(-20, 20, n_samples),
            'bid_ask_spread': np.random.uniform(0.001, 0.01, n_samples),
            'slippage_estimate': np.random.uniform(0.1, 0.5, n_samples),
            'market_cap': np.random.uniform(1e8, 1e12, n_samples),
            'trading_volume_24h': np.random.uniform(1e6, 1e9, n_samples),
            'trading_volume_1h': np.random.uniform(1e5, 1e8, n_samples),
            'correlation_with_btc': np.random.uniform(-0.5, 0.9, n_samples),
            'correlation_with_eth': np.random.uniform(-0.4, 0.95, n_samples),
            'beta_to_market': np.random.uniform(-0.5, 1.5, n_samples),
            
            # Network features
            'gas_price': np.random.uniform(5, 100, n_samples),
            'gas_price_24h_change': np.random.uniform(-50, 50, n_samples),
            'gas_price_percentile': np.random.uniform(0, 100, n_samples),
            'estimated_gas_cost': np.random.uniform(0.01, 1.0, n_samples),
            'block_time': np.random.uniform(1, 15, n_samples),
            'block_utilization': np.random.uniform(0.1, 1.0, n_samples),
            'pending_transactions': np.random.uniform(100, 10000, n_samples),
            'mempool_size': np.random.uniform(100, 10000, n_samples),
            'mempool_congestion': np.random.uniform(0, 1, n_samples),
            'pending_arbitrage_txs': np.random.uniform(0, 50, n_samples),
            'tps': np.random.uniform(10, 100, n_samples),
            
            # Competition features
            'mev_bot_count': np.random.randint(0, 20, n_samples),
            'mev_bot_activity_24h': np.random.uniform(0, 1000, n_samples),
            'front_run_rate': np.random.uniform(0, 0.3, n_samples),
            'sandwich_rate': np.random.uniform(0, 0.2, n_samples),
            'competition_level': np.random.uniform(0, 1, n_samples),
            'expected_competitors': np.random.randint(0, 10, n_samples),
            'win_probability': np.random.uniform(0.25, 0.75, n_samples),
            'priority_fee_estimate': np.random.uniform(0, 5, n_samples),
            'historical_win_rate': np.random.uniform(0.3, 0.7, n_samples),
            
            # Temporal features
            'hour_of_day': np.random.randint(0, 24, n_samples),
            'day_of_week': np.random.randint(0, 7, n_samples),
            'is_weekend': np.random.randint(0, 2, n_samples),
            'is_trading_hours': np.random.randint(0, 2, n_samples),
            'month_of_year': np.random.randint(0, 12, n_samples),
            'quarter_of_year': np.random.randint(0, 4, n_samples),
            'is_quarter_end': np.random.randint(0, 2, n_samples),
            'volatility_session': np.random.uniform(0.3, 0.9, n_samples),
            'is_holiday': np.random.randint(0, 2, n_samples),
            'is_earnings_season': np.random.randint(0, 2, n_samples),
            
            # Target variables
            'liquidated': np.random.randint(0, 2, n_samples),  # Binary classification
            'profit_usd': np.random.uniform(-100, 500, n_samples),  # Regression
            'competition_outcome': np.random.randint(0, 2, n_samples),  # Binary classification
            'execution_success': np.random.randint(0, 2, n_samples),  # Binary classification
        }
        
        df = pd.DataFrame(data)
        
        # Add some realistic correlations
        df['liquidated'] = ((df['health_factor'] < 1.0) & 
                           (df['distance_to_liquidation'] < 0)).astype(int)
        
        df['profit_usd'] = np.where(
            df['liquidated'] == 1,
            np.random.uniform(10, 500, n_samples),
            np.random.uniform(-100, 50, n_samples)
        )
        
        df['competition_outcome'] = (df['competition_level'] > 0.7).astype(int)
        
        return df
    
    def engineer_features(self, data: pd.DataFrame) -> pd.DataFrame:
        """Engineer features from raw data"""
        df = data.copy()
        
        # Create interaction features
        df['health_x_volatility'] = df['health_factor'] * df['price_volatility_24h']
        df['collateral_x_gas'] = df['collateral_usd'] * df['gas_price']
        df['competition_x_liquidity'] = df['competition_level'] * df['liquidity_depth']
        
        # Create polynomial features for important variables
        df['health_factor_squared'] = df['health_factor'] ** 2
        df['gas_price_squared'] = df['gas_price'] ** 2
        
        # Create ratio features
        df['gas_to_profit_ratio'] = df['estimated_gas_cost'] / (df['profit_usd'].abs() + 1)
        df['liquidity_to_volume_ratio'] = df['liquidity_depth'] / (df['trading_volume_24h'] + 1)
        
        # Remove binning features to avoid feature name mismatches
        # These can be added back later if needed with proper handling
        
        logger.info(f"Engineered features. Shape: {df.shape}")
        return df
    
    def split_data(self, data: pd.DataFrame, target_column: str, 
                   test_size: float = 0.2, val_size: float = 0.1) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """Split data into train, validation, and test sets"""
        # Determine if target is categorical or continuous
        is_categorical = data[target_column].nunique() <= 10  # Assume categorical if <= 10 unique values
        
        # First split: separate test set
        train_val, test = train_test_split(
            data, 
            test_size=test_size, 
            random_state=42, 
            stratify=data[target_column] if is_categorical else None
        )
        
        # Second split: separate train and validation
        train, val = train_test_split(
            train_val, 
            test_size=val_size/(1-test_size), 
            random_state=42, 
            stratify=train_val[target_column] if is_categorical else None
        )
        
        logger.info(f"Data split - Train: {len(train)}, Val: {len(val)}, Test: {len(test)}")
        return train, val, test
    
    def balance_classes(self, data: pd.DataFrame, target_column: str) -> pd.DataFrame:
        """Balance classes using oversampling for minority class"""
        if target_column not in data.columns:
            return data
            
        class_counts = data[target_column].value_counts()
        logger.info(f"Class distribution before balancing: {class_counts.to_dict()}")
        
        # Separate classes
        majority_class = data[data[target_column] == class_counts.idxmax()]
        minority_class = data[data[target_column] == class_counts.idxmin()]
        
        # Oversample minority class
        minority_oversampled = minority_class.sample(
            n=len(majority_class), 
            replace=True, 
            random_state=42
        )
        
        # Combine and shuffle
        balanced_data = pd.concat([majority_class, minority_oversampled]).sample(frac=1, random_state=42)
        
        logger.info(f"Class distribution after balancing: {balanced_data[target_column].value_counts().to_dict()}")
        return balanced_data
    
    def scale_features(self, train: pd.DataFrame, val: pd.DataFrame, test: pd.DataFrame, 
                      exclude_columns: List[str], model_name: str = 'default') -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """Scale numerical features with model-specific scalers"""
        # Get numerical columns from train data
        numerical_columns = train.select_dtypes(include=[np.number]).columns.tolist()
        numerical_columns = [col for col in numerical_columns if col not in exclude_columns]
        
        logger.info(f"Found {len(numerical_columns)} numerical features to scale for {model_name}")
        
        # Use model-specific scaler or create new one
        if model_name not in self.scalers:
            self.scalers[model_name] = StandardScaler()
        
        scaler = self.scalers[model_name]
        
        # Fit scaler on training data
        train_scaled = train.copy()
        val_scaled = val.copy()
        test_scaled = test.copy()
        
        train_scaled[numerical_columns] = scaler.fit_transform(train[numerical_columns])
        
        # Transform val and test using the same columns
        val_numerical_cols = [col for col in numerical_columns if col in val.columns]
        val_scaled[val_numerical_cols] = scaler.transform(val[val_numerical_cols])
        
        test_numerical_cols = [col for col in numerical_columns if col in test.columns]
        test_scaled[test_numerical_cols] = scaler.transform(test[test_numerical_cols])
        
        logger.info(f"Scaled {len(numerical_columns)} numerical features for {model_name}")
        return train_scaled, val_scaled, test_scaled


class ModelTrainer:
    """Trains various ML models for arbitrage prediction"""
    
    def __init__(self, model_path: str = "./models/"):
        self.model_path = model_path
        os.makedirs(model_path, exist_ok=True)
        
    def train_liquidation_model(self, X_train: np.ndarray, y_train: np.ndarray) -> Dict[str, Any]:
        """Train model to predict liquidation probability"""
        logger.info("Training liquidation prediction model...")
        
        # Use Gradient Boosting for better performance
        model = GradientBoostingClassifier(
            n_estimators=100,
            learning_rate=0.1,
            max_depth=5,
            random_state=42
        )
        
        # Train the model directly (simplified to avoid grid search issues)
        model.fit(X_train, y_train)
        
        logger.info("Liquidation model trained successfully")
        
        return {
            'model': model,
            'type': 'classification',
            'target': 'liquidation',
            'best_params': {
                'n_estimators': 100,
                'learning_rate': 0.1,
                'max_depth': 5
            },
            'feature_importance': dict(zip(
                [f'feature_{i}' for i in range(X_train.shape[1])],
                model.feature_importances_.tolist()
            ))
        }
    
    def train_profitability_model(self, X_train: np.ndarray, y_train: np.ndarray) -> Dict[str, Any]:
        """Train model to predict arbitrage profitability"""
        logger.info("Training profitability prediction model...")
        
        # Use Gradient Boosting Regressor
        model = GradientBoostingRegressor(
            n_estimators=100,
            learning_rate=0.1,
            max_depth=5,
            random_state=42
        )
        
        # Train the model directly
        model.fit(X_train, y_train)
        
        logger.info("Profitability model trained successfully")
        
        return {
            'model': model,
            'type': 'regression',
            'target': 'profitability',
            'best_params': {
                'n_estimators': 100,
                'learning_rate': 0.1,
                'max_depth': 5
            },
            'feature_importance': dict(zip(
                [f'feature_{i}' for i in range(X_train.shape[1])],
                model.feature_importances_.tolist()
            ))
        }
    
    def train_competition_model(self, X_train: np.ndarray, y_train: np.ndarray) -> Dict[str, Any]:
        """Train model to predict competition intensity"""
        logger.info("Training competition prediction model...")
        
        # Use Random Forest for competition prediction
        model = RandomForestClassifier(
            n_estimators=100,
            max_depth=10,
            random_state=42,
            class_weight='balanced'
        )
        
        # Train the model directly
        model.fit(X_train, y_train)
        
        logger.info("Competition model trained successfully")
        
        return {
            'model': model,
            'type': 'classification',
            'target': 'competition',
            'best_params': {
                'n_estimators': 100,
                'max_depth': 10,
                'class_weight': 'balanced'
            },
            'feature_importance': dict(zip(
                [f'feature_{i}' for i in range(X_train.shape[1])],
                model.feature_importances_.tolist()
            ))
        }
    
    def train_ensemble_model(self, models: List[Dict[str, Any]], X_train: np.ndarray, y_train: np.ndarray) -> Dict[str, Any]:
        """Train an ensemble model combining multiple base models"""
        logger.info("Training ensemble model...")
        
        # Extract base models
        base_models = [model_info['model'] for model_info in models]
        
        # Create ensemble using stacking
        from sklearn.ensemble import StackingClassifier, StackingRegressor
        
        # Determine if classification or regression based on first model
        if models[0]['type'] == 'classification':
            ensemble = StackingClassifier(
                estimators=[(f'model_{i}', model) for i, model in enumerate(base_models)],
                final_estimator=GradientBoostingClassifier(random_state=42),
                cv=5
            )
        else:
            ensemble = StackingRegressor(
                estimators=[(f'model_{i}', model) for i, model in enumerate(base_models)],
                final_estimator=GradientBoostingRegressor(random_state=42),
                cv=5
            )
        
        ensemble.fit(X_train, y_train)
        
        return {
            'model': ensemble,
            'type': models[0]['type'],
            'target': 'ensemble',
            'base_models': [model_info['target'] for model_info in models]
        }


class ModelEvaluator:
    """Evaluates trained ML models"""
    
    def evaluate_classification(self, model: Any, X: np.ndarray, y: np.ndarray) -> Dict[str, Any]:
        """Evaluate classification model"""
        y_pred = model.predict(X)
        y_pred_proba = model.predict_proba(X) if hasattr(model, 'predict_proba') else None
        
        accuracy = (y_pred == y).mean()
        
        report = classification_report(y, y_pred, output_dict=True)
        conf_matrix = confusion_matrix(y, y_pred)
        
        return {
            'accuracy': accuracy,
            'classification_report': report,
            'confusion_matrix': conf_matrix.tolist(),
            'predictions': y_pred.tolist(),
            'probabilities': y_pred_proba.tolist() if y_pred_proba is not None else None
        }
    
    def evaluate_regression(self, model: Any, X: np.ndarray, y: np.ndarray) -> Dict[str, Any]:
        """Evaluate regression model"""
        y_pred = model.predict(X)
        
        mse = mean_squared_error(y, y_pred)
        rmse = np.sqrt(mse)
        r2 = r2_score(y, y_pred)
        mae = np.mean(np.abs(y - y_pred))
        
        return {
            'mse': mse,
            'rmse': rmse,
            'r2': r2,
            'mae': mae,
            'predictions': y_pred.tolist(),
            'residuals': (y - y_pred).tolist()
        }
    
    def cross_validate(self, model: Any, X: np.ndarray, y: np.ndarray, cv: int = 5) -> Dict[str, Any]:
        """Perform cross-validation on model"""
        scoring = 'f1' if hasattr(model, 'predict_proba') else 'neg_mean_squared_error'
        scores = cross_val_score(model, X, y, cv=cv, scoring=scoring)
        
        return {
            'scores': scores.tolist(),
            'mean': scores.mean(),
            'std': scores.std(),
            'scoring': scoring
        }
    
    def feature_importance(self, model: Any, feature_names: List[str]) -> Dict[str, float]:
        """Get feature importance from model"""
        if hasattr(model, 'feature_importances_'):
            importances = model.feature_importances_
            return dict(zip(feature_names, importances.tolist()))
        elif hasattr(model, 'coef_'):
            coefficients = np.abs(model.coef_[0])
            return dict(zip(feature_names, coefficients.tolist()))
        else:
            return {}


class ModelExporter:
    """Exports trained models for use in TypeScript bot"""
    
    def __init__(self, export_path: str = "./exported_models/", scaler_dict: Dict[str, StandardScaler] = None):
        self.export_path = export_path
        self.scaler_dict = scaler_dict or {}
        os.makedirs(export_path, exist_ok=True)
    
    def export_model(self, model_info: Dict[str, Any], model_name: str) -> str:
        """Export model to joblib format"""
        model = model_info['model']
        export_file = os.path.join(self.export_path, f"{model_name}.joblib")
        
        joblib.dump(model, export_file)
        logger.info(f"Exported model to {export_file}")
        
        return export_file
    
    def export_scaler(self, model_name: str) -> str:
        """Export the scaler for a specific model"""
        if model_name in self.scaler_dict:
            scaler_file = os.path.join(self.export_path, f"{model_name}_scaler.joblib")
            joblib.dump(self.scaler_dict[model_name], scaler_file)
            logger.info(f"Exported scaler to {scaler_file}")
            return scaler_file
        return ""
    
    def export_model_metadata(self, model_info: Dict[str, Any], model_name: str) -> str:
        """Export model metadata to JSON"""
        metadata = {
            'model_name': model_name,
            'type': model_info['type'],
            'target': model_info['target'],
            'best_params': model_info.get('best_params', {}),
            'feature_importance': model_info.get('feature_importance', {}),
            'export_timestamp': datetime.now().isoformat(),
            'version': '1.0'
        }
        
        metadata_file = os.path.join(self.export_path, f"{model_name}_metadata.json")
        
        with open(metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        logger.info(f"Exported metadata to {metadata_file}")
        return metadata_file
    
    def export_evaluation_results(self, evaluation: Dict[str, Any], model_name: str) -> str:
        """Export evaluation results to JSON"""
        results_file = os.path.join(self.export_path, f"{model_name}_evaluation.json")
        
        # Convert numpy types to Python types for JSON serialization
        def convert_types(obj):
            if isinstance(obj, np.integer):
                return int(obj)
            elif isinstance(obj, np.floating):
                return float(obj)
            elif isinstance(obj, np.ndarray):
                return obj.tolist()
            return obj
        
        def clean_dict(d):
            return {k: convert_types(v) if not isinstance(v, dict) else clean_dict(v) 
                   for k, v in d.items()}
        
        cleaned_evaluation = clean_dict(evaluation)
        
        with open(results_file, 'w') as f:
            json.dump(cleaned_evaluation, f, indent=2)
        
        logger.info(f"Exported evaluation results to {results_file}")
        return results_file


def main():
    """Main training pipeline"""
    logger.info("Starting ML model training pipeline...")
    
    # Initialize components
    data_preparer = DataPreparer()
    model_trainer = ModelTrainer()
    model_evaluator = ModelEvaluator()
    model_exporter = ModelExporter(scaler_dict=data_preparer.scalers)
    
    # Load and prepare data
    logger.info("Loading and preparing data...")
    raw_data = data_preparer.load_historical_data()
    engineered_data = data_preparer.engineer_features(raw_data)
    
    # Train Liquidation Model
    logger.info("\n" + "="*50)
    logger.info("Training Liquidation Prediction Model")
    logger.info("="*50)
    
    liquidation_data = engineered_data.copy()
    
    # Split data first before balancing to avoid data leakage
    X_liquidation = liquidation_data.drop(['liquidated', 'profit_usd', 'competition_outcome', 'execution_success'], axis=1)
    y_liquidation = liquidation_data['liquidated']
    
    X_train_liq, X_val_liq, X_test_liq = data_preparer.split_data(
        liquidation_data, 'liquidated', test_size=0.2, val_size=0.1
    )
    
    # Balance only the training data
    train_balanced = data_preparer.balance_classes(X_train_liq, 'liquidation')
    X_train_liq_balanced = train_balanced.drop(['liquidated', 'profit_usd', 'competition_outcome', 'execution_success'], axis=1)
    y_train_liq_balanced = train_balanced['liquidated']
    
    # Drop target columns from val and test
    X_val_liq_features = X_val_liq.drop(['liquidated', 'profit_usd', 'competition_outcome', 'execution_success'], axis=1)
    X_test_liq_features = X_test_liq.drop(['liquidated', 'profit_usd', 'competition_outcome', 'execution_success'], axis=1)
    
    # Scale features
    X_train_liq_scaled, X_val_liq_scaled, X_test_liq_scaled = data_preparer.scale_features(
        X_train_liq_balanced, X_val_liq_features, X_test_liq_features, [], 'liquidation'
    )
    
    liquidation_model = model_trainer.train_liquidation_model(
        X_train_liq_scaled.values, y_train_liq_balanced.values
    )
    
    liquidation_eval = model_evaluator.evaluate_classification(
        liquidation_model['model'], X_test_liq_scaled.values, 
        X_test_liq['liquidated'].values
    )
    
    model_exporter.export_model(liquidation_model, 'liquidation_model')
    model_exporter.export_scaler('liquidation')
    model_exporter.export_model_metadata(liquidation_model, 'liquidation_model')
    model_exporter.export_evaluation_results(liquidation_eval, 'liquidation_model')
    
    logger.info(f"Liquidation Model Accuracy: {liquidation_eval['accuracy']:.4f}")
    logger.info("Liquidation model exported successfully")
    
    # Train Profitability Model
    logger.info("\n" + "="*50)
    logger.info("Training Profitability Prediction Model")
    logger.info("="*50)
    
    profitability_data = engineered_data.copy()
    
    # Split data first
    X_profit = profitability_data.drop(['liquidated', 'profit_usd', 'competition_outcome', 'execution_success'], axis=1)
    y_profit = profitability_data['profit_usd']
    
    X_train_prof, X_val_prof, X_test_prof = data_preparer.split_data(
        profitability_data, 'profit_usd', test_size=0.2, val_size=0.1
    )
    
    # Drop target columns from all splits
    X_train_prof_features = X_train_prof.drop(['liquidated', 'profit_usd', 'competition_outcome', 'execution_success'], axis=1)
    X_val_prof_features = X_val_prof.drop(['liquidated', 'profit_usd', 'competition_outcome', 'execution_success'], axis=1)
    X_test_prof_features = X_test_prof.drop(['liquidated', 'profit_usd', 'competition_outcome', 'execution_success'], axis=1)
    
    # Scale features
    X_train_prof_scaled, X_val_prof_scaled, X_test_prof_scaled = data_preparer.scale_features(
        X_train_prof_features, X_val_prof_features, X_test_prof_features, [], 'profitability'
    )
    
    profitability_model = model_trainer.train_profitability_model(
        X_train_prof_scaled.values, X_train_prof['profit_usd'].values
    )
    
    profitability_eval = model_evaluator.evaluate_regression(
        profitability_model['model'], X_test_prof_scaled.values,
        X_test_prof['profit_usd'].values
    )
    
    model_exporter.export_model(profitability_model, 'profitability_model')
    model_exporter.export_scaler('profitability')
    model_exporter.export_model_metadata(profitability_model, 'profitability_model')
    model_exporter.export_evaluation_results(profitability_eval, 'profitability_model')
    
    logger.info(f"Profitability Model R²: {profitability_eval['r2']:.4f}")
    logger.info(f"Profitability Model RMSE: {profitability_eval['rmse']:.4f}")
    logger.info("Profitability model exported successfully")
    
    # Train Competition Model
    logger.info("\n" + "="*50)
    logger.info("Training Competition Prediction Model")
    logger.info("="*50)
    
    competition_data = engineered_data.copy()
    
    # Split data first before balancing
    X_comp = competition_data.drop(['liquidated', 'profit_usd', 'competition_outcome', 'execution_success'], axis=1)
    y_comp = competition_data['competition_outcome']
    
    X_train_comp, X_val_comp, X_test_comp = data_preparer.split_data(
        competition_data, 'competition_outcome', test_size=0.2, val_size=0.1
    )
    
    # Balance only the training data
    train_balanced_comp = data_preparer.balance_classes(X_train_comp, 'competition_outcome')
    X_train_comp_balanced = train_balanced_comp.drop(['liquidated', 'profit_usd', 'competition_outcome', 'execution_success'], axis=1)
    y_train_comp_balanced = train_balanced_comp['competition_outcome']
    
    # Drop target columns from val and test
    X_val_comp_features = X_val_comp.drop(['liquidated', 'profit_usd', 'competition_outcome', 'execution_success'], axis=1)
    X_test_comp_features = X_test_comp.drop(['liquidated', 'profit_usd', 'competition_outcome', 'execution_success'], axis=1)
    
    # Scale features
    X_train_comp_scaled, X_val_comp_scaled, X_test_comp_scaled = data_preparer.scale_features(
        X_train_comp_balanced, X_val_comp_features, X_test_comp_features, [], 'competition'
    )
    
    competition_model = model_trainer.train_competition_model(
        X_train_comp_scaled.values, y_train_comp_balanced.values
    )
    
    competition_eval = model_evaluator.evaluate_classification(
        competition_model['model'], X_test_comp_scaled.values,
        X_test_comp['competition_outcome'].values
    )
    
    model_exporter.export_model(competition_model, 'competition_model')
    model_exporter.export_scaler('competition')
    model_exporter.export_model_metadata(competition_model, 'competition_model')
    model_exporter.export_evaluation_results(competition_eval, 'competition_model')
    
    logger.info(f"Competition Model Accuracy: {competition_eval['accuracy']:.4f}")
    logger.info("Competition model exported successfully")
    
    logger.info("\n" + "="*50)
    logger.info("Training Pipeline Complete!")
    logger.info("="*50)
    logger.info("Models exported to ./exported_models/")
    logger.info("Ready for integration with TypeScript bot")


if __name__ == "__main__":
    main()