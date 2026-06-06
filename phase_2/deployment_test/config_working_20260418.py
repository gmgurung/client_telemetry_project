import os

MODEL_BUCKET           = os.environ.get("FRUSTRATION_MODEL_BUCKET",           "sagemaker-studio-i0gutcxdy")
RAW_BUCKET             = os.environ.get("FRUSTRATION_RAW_BUCKET",             "sagemaker-us-east-1-197337164107")
S3_MODEL_PREFIX        = os.environ.get("FRUSTRATION_S3_MODEL_PREFIX",        "frustration-model/models")
S3_RAW_PREFIX          = os.environ.get("FRUSTRATION_S3_RAW_PREFIX",          "raw/")
S3_PREPROCESSED_PREFIX = os.environ.get("FRUSTRATION_S3_PREPROCESSED_PREFIX", "frustration-model/preprocessed_data")
S3_RESULTS_PREFIX      = os.environ.get("FRUSTRATION_S3_RESULTS_PREFIX",      "frustration-model/results")

# RDS connection settings (PostgreSQL)
RDS_HOST     = os.environ.get("RDS_HOST",     "")
RDS_PORT     = os.environ.get("RDS_PORT",     "5432")
RDS_DB       = os.environ.get("RDS_DB",       "telemetry")
RDS_USER     = os.environ.get("RDS_USER",     "")
RDS_PASSWORD = os.environ.get("RDS_PASSWORD", "")
RDS_TABLE    = os.environ.get("RDS_TABLE",    "feature_vectors")

# SageMaker Serverless Inference endpoint
SAGEMAKER_ENDPOINT_NAME    = os.environ.get("SAGEMAKER_ENDPOINT_NAME",    "frustration-scoring-endpoint")
SAGEMAKER_EXECUTION_ROLE   = os.environ.get("SAGEMAKER_EXECUTION_ROLE",   "")
SAGEMAKER_REGION           = os.environ.get("AWS_REGION",                 "us-east-1")
SERVERLESS_MEMORY_MB       = int(os.environ.get("SERVERLESS_MEMORY_MB",   "3072"))
SERVERLESS_MAX_CONCURRENCY = int(os.environ.get("SERVERLESS_MAX_CONCURRENCY", "5"))

INSTANCE_TYPE = "ml.m5.xlarge"