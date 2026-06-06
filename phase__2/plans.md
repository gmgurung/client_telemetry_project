# Proposed Fixes and Improvements

## 1. Fix Model Ensemble Inconsistencies
* **Status:** **DONE**
* **Resolution:** `serve.py`, `train.py`, `inference.py`, `utils.py`, and `client.py` were all updated to consistently use a 2-model ensemble consisting of an Autoencoder and an Isolation Forest.

## 2. Migrate from PyOD to Scikit-Learn for GMM
* **Status:** **DONE (Obsoleted)**
* **Resolution:** The Gaussian Mixture Model (GMM) was removed entirely from the pipeline in favor of a more robust 2-model ensemble. PyOD vs Scikit-Learn inconsistencies are no longer an issue.

## 3. Configuration Management (Remove Hardcoded Values)
* **Status:** **DONE**
* **Resolution:** Introduced `config.py` to centralize environment configurations including S3 bucket names, RDS database connection strings, and SageMaker endpoint parameters.

## 4. Code Duplication
* **Status:** **DONE**
* **Resolution:** Created `utils.py` to consolidate the `calculate_severity` and `compute_frustration_score` functions, reducing redundancy.

## 5. Scheduler Minor Fixes
* **Status:** **DONE**
* **Resolution:** Fixed misleading comments in `scheduler.py` to correctly indicate scheduling for every 2 minutes.

## 6. Dependency Management
* **Status:** **DONE**
* **Resolution:** `requirements.txt` has been populated with the necessary packages (pandas, numpy, scikit-learn, tensorflow, boto3, sagemaker, schedule, joblib, sqlalchemy, psycopg2-binary).

## 7. Real-Time Serving via SageMaker Serverless Inference
* **Status:** **DONE**
* **Resolution:** Created `deploy_endpoint.py` and updated `serve.py` to support deployment via a Real-Time SageMaker endpoint (using `ml.m5.xlarge`) instead of Serverless, resolving previous deployment failures.

## 8. Generalize Data Preprocessing for Cross-Platform Support
* **Status:** **DONE**
* **Resolution:** Decoupled data ingestion into `InMemoryDataLoader` and `S3DataLoader`. Added a configuration-driven schema mapping (`config/schema_default.json`) to standardize varying platform event names.

## 9. Include User ID in Processed Output
* **Status:** **DONE**
* **Resolution:** `preprocess.py` and downstream data structures were updated to extract and pass through `userId` into final output CSVs and database tables.

## 10. Include Platform Categorization in Processed Output
* **Status:** **DONE**
* **Resolution:** Added platform categorization via schema files (e.g. `"platform": "web"`) and accommodated this within preprocessing logic.

## 11. Robust Pipeline Deployment & Data Sourcing
* **Status:** **DONE**
* **Resolution:** Added a `save_to_rds` feature in `preprocess.py` utilizing SQLAlchemy to insert preprocessed telemetry data into an external PostgreSQL instance. Further orchestration via `client.py` was refined.

## 12. Robust Model Versioning and Automatic Fallback
* **Status:** **DONE**
* **Resolution:** `train.py` now includes a `validate_training_output` routine to ensure score stability prior to S3 upload. `client.py` has an improved `sync_brain()` system that automatically falls back to older model versions or local artifacts upon validation failures.

## 13. Semi-Supervised Feedback Loop (Threshold Tuning & Weighting)
* **Issue:** The current unsupervised models rely on hardcoded percentiles for thresholds and use equal weighting for the final ensemble score. This ignores valuable human feedback (manually labeled sessions) which could significantly improve the model's accuracy.
* **Fix:** Introduce a conditional feedback optimization step in `train.py`:
  1. **Conditional Execution:** Check if a `manually_labeled.csv` (human feedback) file is provided during training. If it is NOT provided, gracefully fall back to the existing unsupervised logic.
  2. **Dynamic Threshold Tuning:** If labeled data is available, run the trained unsupervised models over this validation set. Programmatically sweep and select the percentile thresholds that maximize the F1-Score or Precision against the human labels.
  3. **Supervised Meta-Model (Weighted Ensemble):** Use the raw outputs of the models as features to train a lightweight supervised classifier (e.g., Logistic Regression) on the labeled data. This will learn the optimal weights for the final ensemble score. Save these optimized thresholds and weights into `model_metadata.joblib`.
* **Implementation:** Code

## 14. Database-Centric Batch Inference Architecture (Scaling)
* **Issue:** The current pipeline relies on a continuous 24/7 local `scheduler.py` daemon pulling flat files from S3. As the user base scales to 100,000+ concurrent users sending data continuously, saving independent telemetry files creates massive I/O overhead. Furthermore, arbitrarily chunking a continuous firehose of flat files risks splitting a single user's 5-minute session across multiple files, breaking the `SessionAggregator` logic.
* **Fix:** Transition to a stateful, database-centric micro-batching architecture:
  1. **Continuous DB Ingestion:** Have the data/backend teams write incoming telemetry events directly into a high-throughput database (e.g., Amazon DynamoDB or an optimized RDS/time-series DB), keyed by `sessionId` and `timestamp`, as the events occur in real-time.
  2. **Scheduled Micro-Batches:** Replace the local `scheduler.py` with an AWS EventBridge rule (cron) that triggers a robust AWS ECS Task or AWS Lambda function on a set interval (e.g., every 5 minutes).
  3. **Session-Safe Aggregation:** The triggered batch job queries the database for all events belonging to sessions that have either completed (e.g., received a `session_end` event) or have been active for > 5 minutes. 
  4. **Vectorized Processing & Data Purge:** By querying complete, unbroken sessions directly from the database, the batch job can safely construct a massive, multi-user Pandas DataFrame. This single large matrix is then preprocessed (`FeatureExtractor`) and scored in one highly efficient, vectorized operation. Once successfully scored and saved to S3, the raw events must be purged or archived from the active database table to maintain query performance.
* **Implementation:** Both (Code & AWS Service)

## 15. Decoupled Dashboard Storage (Scaling & Reliability)
* **Issue:** Direct, synchronous integration between the dashboard and the ML inference script (or SageMaker Endpoint) creates a severe bottleneck at scale. It forces redundant, expensive ML compute for every dashboard load, introduces high latency, and creates a single point of failure (if the ML pipeline crashes, the dashboard goes blank).
* **Fix:** Implement a decoupled, "Write-Once, Read-Many" architecture:
  1. **Fast Output Database:** Update `client.py` (and the future batch jobs) to write the final engineered features and Frustration Scores (`predictions.csv`) into a fast, query-optimized database (e.g., PostgreSQL, DynamoDB, or Elasticsearch) in addition to (or instead of) S3 flat files.
  2. **Dashboard Auto-Polling:** The analytics dashboard should be strictly read-only, querying this fast database for its data. Implement auto-polling (or WebSockets) on the dashboard frontend to pull the latest scored rows every 30-60 seconds, providing a "live" updating experience that is instantly responsive and completely insulated from upstream ML pipeline failures.
* **Implementation:** Both (Code & AWS Service)