# Test Plan - Phase 2: Feature Engineering & Frustration Scoring

This document outlines the testing strategy for the backend components of the Telemetry Frustration Scoring Pipeline, specifically focusing on Phase 2 (Data Processing & ML) as defined in the `VanguardClientTelemetry_CS493_SystemTestPlan`.

## 1. Scope (Phase 2)
Phase 2 encompasses the core "intelligence" of the system. Testing ensures that raw telemetry is accurately transformed into meaningful features, and that the ML models provide reliable, consistent frustration scores. The following components are in scope:

- **`preprocess.py` (Data Transformation)**: Handles ingestion of raw events, groups them into logical sessions, and calculates behavioral features (e.g., dwell time, click rates). It must handle schema variations across platforms (Web/Mobile) via mapping.
- **`train.py` (Model Lifecycle)**: Responsible for training the 2-model ensemble (Autoencoder & Isolation Forest). Testing focuses on artifact generation, performance validation, and pre-upload sanity checks.
- **`client.py` (Orchestration & Local Inference)**: The main entry point for batch processing. It manages the "Brain Swap" (syncing models from S3), local file handling, and scoring logic.
- **`utils.py` (Shared Logic)**: Contains the mathematical heart of the system, including score normalization and the mapping of scores to human-readable severity levels (Normal, Medium, High).
- **`serve.py` & `inference.py` (SageMaker Deployment)**: Logic for the live inference endpoint. Tests verify that the containerized model correctly handles HTTP requests and returns standardized JSON scores.
- **AWS Infrastructure (Triggering & Storage)**: Validating the integration with S3 (raw data sourcing), RDS (feature storage), and EventBridge (automated pipeline triggering).

## 2. Unit Testing

### 2.1 Metric Calculations (`preprocess.py`)
Verify that the aggregation logic correctly computes metrics from raw `TelemetryEvent` data. This is critical because downstream models rely on the numerical accuracy of these inputs.
- **Test Case:** Ensure `event_count` matches the number of raw events for a session.
- **Test Case:** Validate `session_duration_ms` is exactly `max(timestamp) - min(timestamp)` for a session.
- **Test Case:** Verify behavioral metrics like `page_view_count` (unique routes) and `total_dwell_ms` are calculated accurately based on route-change events.
- **Test Case:** **Robustness:** Verify handling of "broken" sessions (e.g., sessions with only one event or missing timestamps) to ensure no `NaN` values enter the feature vector.

### 2.2 Severity Classification Logic (`utils.py`)
Validate the mapping of frustration scores (0-1) to severity levels. Consistency here ensures the Dashboard displays the same "High" severity that the model predicted.
- **Test Case:** `score < 0.3` → **Normal**
- **Test Case:** `0.3 <= score < 0.7` → **Medium**
- **Test Case:** `score >= 0.7` → **High**
- **Test Case:** **Boundaries:** Test values like 0.299, 0.300, 0.699, and 0.700 to ensure threshold precision.

### 2.3 Feature Normalization (`scaler.pkl` / `preprocess.py`)
- **Test Case:** Verify that the `StandardScaler` is correctly applied. The scaled output must have a mean near 0 and variance near 1 across a large test set.
- **Test Case:** **Consistency:** Ensure the scaler used during inference is the exact artifact generated during the training of that specific model version.

## 3. Integration Testing

### 3.1 Raw Data → Feature Processing (Phase 1 → Phase 2)
- **Test Case:** Ingest multi-platform raw telemetry (Web and Mobile) and confirm the `feature_vector.csv` output adheres to the standardized schema defined in `config/schema_default.json`.
- **Test Case:** Verify `sessionId` grouping: ensure events from User A do not leak into the feature vector for User B.

### 3.2 Model Artifact Syncing ("Brain Swap")
- **Test Case:** **Download Logic:** Run `client.py` and verify it successfully identifies a newer model version on S3 and updates the `current_brain/` folder.
- **Test Case:** **Fallback Mechanism:** Simulate a corrupted S3 download or a failed validation check and verify the system automatically falls back to the previous stable model version or local artifacts.

### 3.3 Cloud-Native Triggering (EventBridge → Lambda/ECS)
- **Test Case:** Simulate an AWS EventBridge "Scheduled Event" and verify that the trigger successfully invokes the inference task (simulated locally or via AWS CLI).
- **Test Case:** Verify that the pipeline correctly identifies and processes *only* the new data since the last successful run (idempotency).

## 4. System Testing

### 4.1 End-to-End Pipeline Execution
- **Steps:**
    1. Generate a sample raw dataset.
    2. Run `preprocess.py` to create feature vectors.
    3. Run `train.py` to generate and validate new model artifacts.
    4. Run `client.py` to score the data.
- **Success Criteria:** A final prediction CSV exists in `output/` containing `userId`, `platform`, `frustration_score`, and `severity`, and these results match expected behavior for known "frustrating" patterns (e.g., rage clicks).

### 4.2 SageMaker Endpoint Simulation
- **Test Case:** Use `test_endpoint.py` to send a JSON payload to the `serve.py` handler.
- **Expectation:** The handler must return a 200 OK status with a JSON body containing `scores` and `predictions`, with a latency of < 200ms for a single session.

## 5. Test Cases (Cross-Referenced with System Test Plan)

| ID | Title | Component | Priority |
|---|---|---|---|
| **P2-01** | Aggregated Metrics Accuracy | `preprocess.py` | High |
| **P2-02** | Severity Logic Correctness | `utils.py` | High |
| **P2-03** | Inference Workflow (Local) | `client.py` | High |
| **P2-04** | Inference Workflow (SageMaker) | `serve.py` | Medium |
| **P2-05** | Cloud Triggering (EventBridge) | AWS Config | Medium |
| **P2-06** | Feature Mapping Consistency | `config/schema_default.json` | High |
| **P2-07** | Feedback Loop Optimization | `train.py` | High |
| **P2-08** | Database Batching Consistency | DB/Lambda Integration | High |
| **P2-09** | Decoupled Storage Sync | RDS/Dashboard API | Medium |

## 6. Future Implementation Testing (Roadmap Items 13-15)

### 6.1 Semi-Supervised Feedback Loop (Item 13)
Verify that the model evolves using human insight.
- **Test Case:** Provide a `manually_labeled.csv` file. Verify `train.py` calculates the weights for the ensemble (Logistic Regression) and saves them to `model_metadata.joblib`.
- **Test Case:** **Regression:** Ensure the system continues to work in "Pure Unsupervised" mode if no labels are available.

### 6.2 Database-Centric Batching (Item 14)
Validate the transition from file-polling to stateful DB micro-batching.
- **Test Case:** **Session Integrity:** Ensure the DB query retrieves the *entire* history of a session, even if events arrived across multiple ingest windows.
- **Test Case:** **Performance:** Verify that the vectorized preprocessing of 1,000+ sessions from the DB is faster than processing 1,000 individual JSON files from S3.

### 6.3 Decoupled Dashboard Storage (Item 15)
- **Test Case:** Verify `client.py` writes results to the "Fast Output DB" (RDS) and that the Dashboard API reflects these changes within 5 seconds of inference completion.
- **Test Case:** **Reliability:** Verify that a database connection timeout in the ML pipeline does not "crash" the user's view of existing data on the dashboard.

## 7. Verification Tools
- **`pytest`**: For automated unit tests.
- **`test_endpoint.py`**: For SageMaker handler validation.
- **CloudWatch Logs**: To monitor EventBridge and Lambda execution in the cloud environment.
- **SQL Workbench/pgAdmin**: Manual verification of RDS table states.
- **K6 / Locust**: For testing the responsiveness of the decoupled architecture under load.
