#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import re
import tarfile
import argparse
import joblib
import pandas as pd
import numpy as np
import boto3
import tensorflow as tf
try:
    import tf_keras as keras
except ImportError:
    import tensorflow.keras as keras

layers = keras.layers
models = keras.models
optimizers = keras.optimizers

from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import f1_score

def optimize_thresholds(ae_model, iso_forest, scaler, labeled_df, metadata_cols):
    """
    Sweeps percentile thresholds for both AE and IF models on labeled data
    to find the combination that maximizes the F1-Score.
    """
    print("  Running Dynamic Threshold Tuning on labeled data...")
    
    # Prepare labeled features
    X_labeled_raw = labeled_df.drop(columns=[col for col in metadata_cols if col in labeled_df.columns] + ['is_anomalous'])
    y_true = labeled_df['is_anomalous'].values
    X_labeled = scaler.transform(X_labeled_raw).astype(np.float32)

    # Get raw scores
    reconstructed = ae_model.predict(X_labeled, verbose=0)
    ae_mse = np.mean(np.square(X_labeled - reconstructed), axis=1)
    if_raw = iso_forest.decision_function(X_labeled)

    best_f1 = -1.0
    best_ae_p = 90
    best_iso_p = 10

    # Sweep percentiles 50-99 for AE (higher is more anomalous)
    # Sweep percentiles 1-50 for IF (lower is more anomalous)
    for ae_p in range(50, 100):
        ae_thresh = np.percentile(ae_mse, ae_p)
        for iso_p in range(1, 51):
            iso_thresh = np.percentile(if_raw, iso_p)
            
            # Predict
            ae_pred = (ae_mse > ae_thresh).astype(int)
            iso_pred = (if_raw < iso_thresh).astype(int)
            
            # Ensemble: OR logic (either model detects anomaly) or AND logic?
            # In serve.py, we average scores. Here let's mimic the 'either' logic for simple thresholding
            y_pred = ((ae_pred + iso_pred) > 0).astype(int)
            
            score = f1_score(y_true, y_pred)
            if score > best_f1:
                best_f1 = score
                best_ae_p = ae_p
                best_iso_p = iso_p

    print(f"  Optimization complete. Best F1: {best_f1:.3f} (AE P{best_ae_p}, IF P{best_iso_p})")
    
    # Return the actual values for the thresholds
    return np.percentile(ae_mse, best_ae_p), np.percentile(if_raw, best_iso_p)

def validate_training_output(model_dir: str, X_test: np.ndarray) -> bool:
    """
    Validates trained artifacts by scoring the test set through the 2-model ensemble
    (Autoencoder + Isolation Forest — matching inference.py's scoring logic).

    Checks:
      1. All scores are finite (no NaN / Inf).
      2. Score std > 0.1  — model actually discriminates between sessions.
      3. Mean score in (0.5, 9.5) — output is not degenerate (all-zero or all-max).

    Prints a full validation report. Returns True if all checks pass.
    """
    print("\n--- Validating model artifacts before upload ---")
    try:
        ae         = keras.models.load_model(os.path.join(model_dir, "autoencoder_model.keras"))
        iso_forest = joblib.load(os.path.join(model_dir, "isolation_forest.pkl"))
        scaler     = joblib.load(os.path.join(model_dir, "scaler.pkl"))

        X_scaled      = scaler.transform(X_test).astype(np.float32)
        reconstructed = ae.predict(X_scaled, verbose=0)
        ae_mse        = np.mean(np.square(X_scaled - reconstructed), axis=1)
        if_raw        = iso_forest.decision_function(X_scaled)

        ae_term  = np.clip(10 * ae_mse / 0.05,        0, 10)
        if_term  = np.clip(10 * (0.1 - if_raw) / 0.2, 0, 10)
        scores   = (ae_term + if_term) / 2.0

    except Exception as exc:
        print(f"  [FAIL] Could not load or run artifacts: {exc}")
        return False

    mean_s = float(np.mean(scores))
    std_s  = float(np.std(scores))
    min_s  = float(np.min(scores))
    max_s  = float(np.max(scores))
    pct_high   = float(np.mean(scores >= 9.0) * 100)
    pct_medium = float(np.mean((scores >= 7.0) & (scores < 9.0)) * 100)
    pct_normal = float(np.mean(scores < 7.0) * 100)

    print(f"  Sessions scored : {len(scores)}")
    print(f"  Score mean      : {mean_s:.3f}")
    print(f"  Score std       : {std_s:.3f}")
    print(f"  Score range     : [{min_s:.3f}, {max_s:.3f}]")
    print(f"  Normal (<7)     : {pct_normal:.1f}%")
    print(f"  Medium (7-9)    : {pct_medium:.1f}%")
    print(f"  High   (≥9)     : {pct_high:.1f}%")

    checks = [
        (np.all(np.isfinite(scores)),         "All scores are finite"),
        (std_s > 0.1,                         f"Score std {std_s:.3f} > 0.1 (model discriminates)"),
        (0.5 < mean_s < 9.5,                  f"Mean score {mean_s:.2f} in range (0.5, 9.5)"),
    ]

    all_passed = True
    for ok, description in checks:
        status = "[PASS]" if ok else "[FAIL]"
        print(f"  {status} {description}")
        if not ok:
            all_passed = False

    return all_passed


def get_next_version(bucket, prefix):
    """Scans S3 for existing models and increments the version number."""
    s3_client = boto3.client('s3')
    search_prefix = prefix if prefix.endswith('/') else prefix + '/'
    response = s3_client.list_objects_v2(Bucket=bucket, Prefix=search_prefix)
    
    if 'Contents' not in response:
        print(f"No existing models found in {search_prefix}. Starting at v1.")
        return 1
    
    versions = []
    for obj in response['Contents']:
        match = re.search(r'model_v(\d+)\.tar\.gz', obj['Key'])
        if match:
            versions.append(int(match.group(1)))
    
    next_v = max(versions) + 1 if versions else 1
    print(f"Next model version determined: v{next_v}")
    return next_v

def AutoencoderTF(input_dim):
    input_layer = layers.Input(shape=(input_dim,))
    x = layers.Dense(32, activation='relu')(input_layer)
    x = layers.Dense(16, activation='relu')(x)
    encoded = layers.Dense(8, activation='relu')(x)
    x = layers.Dense(16, activation='relu')(x)
    x = layers.Dense(32, activation='relu')(x)
    decoded = layers.Dense(input_dim, activation='sigmoid')(x)
    autoencoder = models.Model(inputs=input_layer, outputs=decoded)
    return autoencoder

class IsolationForestTF:
    def __init__(self, n_estimators=100, contamination=0.1):
        self.model = IsolationForest(
            n_estimators=n_estimators,
            contamination=contamination,
            random_state=42
        )
    def train(self, X):
        self.model.fit(X)
        return self.model.decision_function(X)

def fetch_labeled_data_from_s3(bucket, key):
    """Downloads labeled data from S3 and returns a DataFrame."""
    s3_client = boto3.client('s3')
    local_tmp = "manually_labeled_tmp.csv"
    try:
        print(f"Fetching labeled feedback data from s3://{bucket}/{key}...")
        s3_client.download_file(bucket, key, local_tmp)
        df = pd.read_csv(local_tmp)
        os.remove(local_tmp)
        return df
    except Exception as e:
        print(f"Warning: Could not fetch labeled data: {e}")
        if os.path.exists(local_tmp):
            os.remove(local_tmp)
        return None

def train_process(args):
    train_path = args.train
    test_path = args.test
    
    print(f"Loading training data from: {train_path}")
    train_df = pd.read_csv(train_path)
    print(f"Loading test data from: {test_path}")
    test_df = pd.read_csv(test_path)
    
    metadata_cols = ['sessionId', 'timestamp']
    train_features = train_df.drop(columns=[col for col in metadata_cols if col in train_df.columns])
    test_features = test_df.drop(columns=[col for col in metadata_cols if col in test_df.columns])
    feature_names = list(train_features.columns)

    print("Scaling features...")
    scaler = StandardScaler()
    X_train = scaler.fit_transform(train_features).astype(np.float32)
    X_test = scaler.transform(test_features).astype(np.float32)

    input_dim = X_train.shape[1]
    
    print("\nFitting Isolation Forest...")
    isolation = IsolationForestTF(n_estimators=args.n_estimators, contamination=args.contamination)
    isolation.train(X_train)
    iso_scores_test = isolation.model.decision_function(X_test)

    print("\nTraining AutoEncoder...")
    ae = AutoencoderTF(input_dim)
    ae.compile(optimizer=optimizers.Adam(learning_rate=args.learning_rate), loss='mse')
    ae.fit(X_train, X_train, epochs=args.epochs, batch_size=32, validation_data=(X_test, X_test), verbose=0)

    reconstructed_test = ae.predict(X_test, verbose=0)
    ae_errors_test = np.mean(np.square(X_test - reconstructed_test), axis=1)

    # 7. Semi-Supervised Feedback Loop (Threshold Tuning)
    from config import MODEL_BUCKET
    ae_threshold = None
    iso_threshold = None

    if args.use_feedback:
        labeled_df = fetch_labeled_data_from_s3(MODEL_BUCKET, args.labeled_data_key)
        if labeled_df is not None:
            try:
                ae_threshold, iso_threshold = optimize_thresholds(
                    ae, isolation.model, scaler, labeled_df, metadata_cols
                )
                print(f"[FEEDBACK] Optimized AE Thresh: {ae_threshold:.6f}, ISO Thresh: {iso_threshold:.6f}")
            except Exception as e:
                print(f"Error during optimization: {e}. Falling back to default percentiles.")
        else:
            print("Falling back to default percentiles due to missing labeled data.")

    if ae_threshold is None:
        ae_threshold  = np.percentile(ae_errors_test, 90)
        iso_threshold = np.percentile(iso_scores_test, 10)
        print(f"[DEFAULT] Using 90/10 percentiles: AE Thresh: {ae_threshold:.6f}, ISO Thresh: {iso_threshold:.6f}")

    # 8. Save Model Artifacts Locally
    model_dir = args.model_dir
    os.makedirs(model_dir, exist_ok=True)

    ae_path     = os.path.join(model_dir, "autoencoder_model.keras")
    iso_path    = os.path.join(model_dir, "isolation_forest.pkl")
    scaler_path = os.path.join(model_dir, "scaler.pkl")
    meta_path   = os.path.join(model_dir, "model_metadata.joblib")

    ae.save(ae_path)
    joblib.dump(isolation.model, iso_path)
    joblib.dump(scaler, scaler_path)

    metadata = {
        "feature_names": feature_names,
        "ae_threshold":  float(ae_threshold),
        "iso_threshold": float(iso_threshold),
        "if_min_score":  float(np.min(iso_scores_test)),
    }
    joblib.dump(metadata, meta_path)

    # 9. Validate artifacts before packaging and upload
    if not validate_training_output(model_dir, test_features.values):
        raise RuntimeError(
            "Trained model failed validation checks. "
            "The tarball will NOT be uploaded to S3. "
            "Inspect the report above and retrain."
        )
    print("[OK] Validation passed — proceeding to package and upload.")

    # 10. Create Versioned Tarball
    from config import MODEL_BUCKET, S3_MODEL_PREFIX
    bucket_name = MODEL_BUCKET
    s3_prefix = S3_MODEL_PREFIX

    version = get_next_version(bucket_name, s3_prefix)
    tar_filename = f"model_v{version}.tar.gz"
    
    print(f"\n--- Creating {tar_filename} ---")
    with tarfile.open(tar_filename, "w:gz") as tar:
        for f in os.listdir(model_dir):
            tar.add(os.path.join(model_dir, f), arcname=f)

    # 11. Upload Tarball to S3
    s3_key = f"{s3_prefix}/{tar_filename}"
    s3_client = boto3.client('s3')
    
    print(f"Uploading tarball to s3://{bucket_name}/{s3_key}...")
    s3_client.upload_file(tar_filename, bucket_name, s3_key)
    
    if os.path.exists(tar_filename):
        os.remove(tar_filename)
        
    print(f"\n[SUCCESS] Training and S3 upload complete. Model version: v{version}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--train', type=str, required=True)
    parser.add_argument('--test', type=str, required=True)
    parser.add_argument('--model-dir', type=str, default='./temp_models')
    parser.add_argument('--epochs', type=int, default=100)
    parser.add_argument('--learning-rate', type=float, default=0.001)
    parser.add_argument('--n-estimators', type=int, default=100)
    parser.add_argument('--contamination', type=float, default=0.1)
    parser.add_argument('--use-feedback', action='store_true', help="Enable semi-supervised feedback loop to tune thresholds")
    parser.add_argument('--labeled-data-key', type=str, default='frustration-model/labelled/manually_labeled.csv', help="S3 key for the human-labeled CSV data")

    args = parser.parse_args()
    train_process(args)
