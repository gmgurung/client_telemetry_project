# Telemetry Frustration Scoring Pipeline

## Project Overview

This project is a machine learning pipeline designed to analyze raw telemetry data and calculate a "Frustration Score" for user sessions. The system identifies anomalous user behavior (like rage clicks, excessive retries, or errors) by aggregating events at the session level and processing them through an ensemble model. 

The models include:
- **Autoencoder** (TensorFlow/Keras) for reconstruction error-based anomaly detection.
- **Isolation Forest** (Scikit-Learn) for tree-based anomaly detection.
*(Note: Gaussian Mixture Model (GMM) was removed in favor of a robust 2-model ensemble)*

Scores are aggregated and normalized into a 0-10 Frustration Score and categorized by severity (Normal, Medium, High).

## Key Components

- **`config.py`**: Centralizes all configuration, including AWS S3 bucket names, S3 prefixes, SageMaker endpoint details, and PostgreSQL RDS connection settings.
- **`utils.py`**: Contains shared scoring logic (`calculate_severity` and `compute_frustration_score`) to maintain consistency.
- **`preprocess.py`**: Handles data ingestion from local paths or S3, utilizing abstracted `InMemoryDataLoader` and `S3DataLoader`. It aggregates raw `TelemetryEvent` data into `SessionData`, applies schema mapping via `config/schema_default.json`, engineers features, and optionally saves the feature vectors to a PostgreSQL RDS instance. Outputs `userId` and `platform` information.
- **`train.py`**: Trains the 2-model ensemble (Autoencoder & Isolation Forest). Includes rigorous pre-upload validation before packaging and uploading versioned model tarballs to an S3 bucket.
- **`client.py`**: Handles the full end-to-end inference workflow. Features "Brain Swap" (syncing models from S3 with automatic fallback on failure). It can score data locally using downloaded artifacts or route requests to the SageMaker Real-Time inference endpoint.
- **`inference.py`**: Extracted scoring script containing HTTP handler logic for processing incoming SageMaker endpoint requests by interacting with TensorFlow serving.
- **`serve.py`**: Provides SageMaker-compatible endpoints (`model_fn`, `predict_fn`, `input_fn`, `output_fn`) for Real-Time inference. Successfully loads the complete 2-model ensemble and scores accordingly.
- **`deploy_endpoint.py`**: A deployment utility for provisioning and updating the SageMaker Real-Time Inference endpoint on `ml.m5.xlarge` instances.
- **`scheduler.py`**: A continuous monitoring daemon. It polls a specific S3 bucket prefix (`raw/`) every 2 minutes for new raw telemetry files and automatically triggers inference when new data is detected.

## Architecture & Storage

- **Local Storage**: 
  - `current_brain/`: Holds the latest synchronized model artifacts.
  - `temp_models/`: Holds models generated during a local training run.
  - `preprocessed/` and `output/`: Store local copies of features and predictions during inference.
- **AWS S3 Integration**: S3 buckets configured in `config.py` are heavily used for raw data ingestion, model artifact versioning, and results storage.
- **RDS Integration**: Processed features can be directly written to an RDS table (PostgreSQL) if configured via `preprocess.py`.

## Building and Running

*Note: These commands depend on appropriate AWS credentials and S3/RDS access.*

**Preprocessing**
```bash
python preprocess.py --input <s3_or_local_path> --output <local_output_dir> --format csv
```

**Training**
```bash
python train.py --train <path_to_train.csv> --test <path_to_test.csv> --epochs 100
```

**Inference via Client (Manual Trigger)**
```bash
python client.py --input <s3_or_local_path_to_raw_data>
```

**Deploying Endpoint**
```bash
python deploy_endpoint.py --endpoint-name <name>
```

**Starting the Scheduler (Automated Inference Pipeline)**
```bash
python scheduler.py
```

## Development Conventions

- Python standard libraries alongside robust ML packages (`pandas`, `numpy`, `tensorflow`, `scikit-learn`, `joblib`).
- Centralized configuration via `config.py`.
- Clear separation of duties: data mapping (`schema.json`), processing (`preprocess.py`), endpoint deployment (`deploy_endpoint.py`), client workflow (`client.py`), and inference logic (`serve.py`).
- Automated versioning and validation logic for model deployments (e.g., `model_v1.tar.gz`).