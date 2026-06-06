# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Telemetry Frustration Scoring Pipeline** — a machine learning system that ingests raw user telemetry events (NDJSON/CSV), aggregates them into sessions, extracts behavioral features, and scores each session with a 0–10 "Frustration Score" using an unsupervised ensemble model.

## Commands

All scripts require AWS credentials configured (via environment variables or `~/.aws/credentials`) since they interact with S3.

**Preprocessing** — converts raw telemetry logs into session-level feature CSVs and uploads train/test splits to S3:
```bash
python preprocess.py --input <s3_uri_or_local_path> --output ./preprocessed --format csv --include-session-id --include-timestamp
```

**Training** — trains the ensemble models and uploads a versioned tarball to S3:
```bash
python train.py --train ./preprocessed/train.csv --test ./preprocessed/test.csv --epochs 100
```

**Inference (manual)** — runs Brain Swap (sync latest models from S3) then scores a new raw data file:
```bash
python inference.py --input s3://sagemaker-us-east-1-197337164107/raw/your_file.jsonl
```

**Scheduler (automated daemon)** — polls S3 `raw/` prefix every 2 minutes and auto-triggers inference:
```bash
python scheduler.py
```

## Architecture

### Data Flow
```
Raw NDJSON/CSV (S3 or local)
  → S3DataLoader (preprocess.py)
  → SessionAggregator  →  SessionData objects
  → FeatureExtractor   →  13-feature vectors
  → [train.py: fit models] or [inference.py: score sessions]
  → predictions CSV (S3 + local ./output/)
```

### Ensemble Models (all stored in `current_brain/`)
- **Autoencoder** (`autoencoder_model.keras`) — reconstruction MSE anomaly detection
- **Isolation Forest** (`isolation_forest.pkl`) — tree-based anomaly detection
- **GMM** (`gmm_model.pkl`) — density-based anomaly detection (currently PyOD, `plans.md` targets migration to sklearn native)
- **Scaler** (`scaler.pkl`) — StandardScaler fit during training
- **Metadata** (`model_metadata.joblib`) — thresholds (`ae_threshold`, `iso_threshold`, `gmm_threshold`) and `feature_names`

Final score = average of three normalized 0–10 scores. Severity: Normal (<7), Medium (7–9), High (≥9).

### Key Files
- `preprocess.py` — all data ingestion and feature engineering logic. The `TelemetryEvent`, `SessionData`, `SessionAggregator`, and `FeatureExtractor` classes are the core data model.
- `train.py` — trains all three models; auto-increments version and uploads `model_vN.tar.gz` to `s3://sagemaker-studio-i0gutcxdy/frustration-model/models/`
- `inference.py` — calls `sync_brain()` to pull the latest versioned tarball from S3 before scoring. Imports `preprocess` directly.
- `scheduler.py` — wraps `inference.py` as a subprocess; tracks processed files in `processed_files.log`
- `serve.py` — SageMaker endpoint interface (`model_fn`, `input_fn`, `predict_fn`, `output_fn`). **Currently inconsistent**: only loads Isolation Forest and GMM (missing Autoencoder), and uses sklearn-native GMM API while `train.py` saves a PyOD GMM object.

### S3 Buckets
- `sagemaker-studio-i0gutcxdy` — model artifacts, preprocessed data, results
- `sagemaker-us-east-1-197337164107` — raw incoming telemetry (`raw/` prefix)

### Local Directories
- `current_brain/` — active model artifacts (synced from S3 by `sync_brain()`)
- `temp_models/` — artifacts from a local training run
- `preprocessed/` — local copies of feature CSVs
- `output/` — local copies of prediction CSVs

## Known Issues (from `plans.md`)

1. **`serve.py` model mismatch** — omits Autoencoder; use `inference.py` scoring logic as reference
2. **GMM library inconsistency** — `train.py`/`inference.py` use PyOD; `serve.py` expects sklearn-native `score_samples`
3. **`requirements.txt` is empty** — dependencies: `pandas`, `numpy`, `scikit-learn`, `tensorflow`, `boto3`, `sagemaker`, `schedule`, `pyod`, `joblib`
4. **Hardcoded S3 bucket names** across all scripts
5. **`scheduler.py` comment says "5 minutes"** but schedules every 2 minutes
6. **`calculate_severity` and scoring math are duplicated** between `inference.py` and `serve.py`

## Feature Schema (13 features)

`event_count`, `page_view_count`, `unique_route_count`, `click_count`, `field_change_count`, `flow_success_count`, `flow_failure_count`, `error_event_count`, `retry_count`, `rage_click_count`, `session_duration_ms`, `total_dwell_ms`, `avg_inter_event_gap_ms`

Input telemetry events must have `sessionId`, `timestamp`, and `eventType` fields to be valid.
