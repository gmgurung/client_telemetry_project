#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import re
import json
import shutil
import joblib
import tarfile
import boto3
import numpy as np
import pandas as pd
import tensorflow as tf
from datetime import datetime
import io
import argparse

import preprocess as prep
from config import (
    MODEL_BUCKET, S3_MODEL_PREFIX, S3_PREPROCESSED_PREFIX, S3_RESULTS_PREFIX,
    SAGEMAKER_ENDPOINT_NAME,
)
from utils import calculate_severity

# --- Local directories ---
LOCAL_BRAIN_DIR       = "./current_brain"
VERSION_FILE          = "current_version.txt"
LOCAL_PREPROCESSED_DIR = "./preprocessed"
LOCAL_OUTPUT_DIR      = "./output"

BUCKET_NAME = MODEL_BUCKET


# ---------------------------------------------------------------------------
# Versioning helpers
# ---------------------------------------------------------------------------

_TEMP_BRAIN_DIR = "./temp_brain"
_TEMP_TAR       = "temp_download.tar.gz"
_N_FEATURES     = 13   # fixed feature contract


def _validate_brain(brain_dir: str) -> bool:
    """
    Smoke-tests models in brain_dir by running dummy data through the
    2-model ensemble (AE + Isolation Forest).
    Returns True if all outputs are finite; False on any error.
    """
    try:
        ae         = tf.keras.models.load_model(os.path.join(brain_dir, "autoencoder_model.keras"))
        iso_forest = joblib.load(os.path.join(brain_dir, "isolation_forest.pkl"))
        scaler     = joblib.load(os.path.join(brain_dir, "scaler.pkl"))
        metadata   = joblib.load(os.path.join(brain_dir, "model_metadata.joblib"))

        n_features = len(metadata.get("feature_names", range(_N_FEATURES)))
        dummy      = np.zeros((2, n_features), dtype=np.float32)   # 2 rows to avoid batch-size edge cases
        X_scaled   = scaler.transform(dummy).astype(np.float32)
        recon      = ae.predict(X_scaled, verbose=0)
        ae_mse     = np.mean(np.square(X_scaled - recon), axis=1)
        if_score   = iso_forest.decision_function(X_scaled)

        assert np.all(np.isfinite(ae_mse)),  "AE MSE contains non-finite values"
        assert np.all(np.isfinite(if_score)), "IF score contains non-finite values"
        return True
    except Exception as exc:
        print(f"  [VALIDATE] FAIL — {exc}")
        return False


def _install_brain(src_dir: str, version: int) -> None:
    """Atomically replaces LOCAL_BRAIN_DIR with src_dir and writes VERSION_FILE."""
    if os.path.exists(LOCAL_BRAIN_DIR):
        shutil.rmtree(LOCAL_BRAIN_DIR)
    shutil.move(src_dir, LOCAL_BRAIN_DIR)
    with open(VERSION_FILE, "w") as f:
        f.write(str(version))


def _download_and_extract(s3, s3_key: str, dest_dir: str) -> None:
    """Downloads a model tarball from S3 and extracts it into dest_dir."""
    if os.path.exists(dest_dir):
        shutil.rmtree(dest_dir)
    os.makedirs(dest_dir, exist_ok=True)
    s3.download_file(BUCKET_NAME, s3_key, _TEMP_TAR)
    with tarfile.open(_TEMP_TAR, "r:gz") as tar:
        tar.extractall(path=dest_dir)
    os.remove(_TEMP_TAR)


def sync_brain() -> int:
    """
    Syncs the best available model from S3 with automatic fallback.

    Strategy:
      1. List all versioned tarballs in S3, sort newest → oldest.
      2. For each version (starting at the latest):
         a. If it is already installed locally and passes validation → use it.
         b. Otherwise download, extract to a temp dir, and validate.
         c. On success → install as the active brain and return version number.
         d. On failure → log the reason and try the next older version.
      3. If every remote version fails, raise RuntimeError.

    Returns the active model version number (int).
    """
    s3   = boto3.client("s3")
    resp = s3.list_objects_v2(Bucket=BUCKET_NAME, Prefix=S3_MODEL_PREFIX)

    versions = []
    for obj in resp.get("Contents", []):
        match = re.search(r"model_v(\d+)\.tar\.gz", obj["Key"])
        if match:
            versions.append((int(match.group(1)), obj["Key"]))
    versions.sort(key=lambda x: x[0], reverse=True)   # newest first

    if not versions:
        # No remote models — validate whatever is installed locally
        if os.path.exists(LOCAL_BRAIN_DIR) and _validate_brain(LOCAL_BRAIN_DIR):
            current_v = int(open(VERSION_FILE).read().strip()) if os.path.exists(VERSION_FILE) else 0
            print(f"--- [BRAIN] No S3 models found. Using local v{current_v} ---")
            return current_v
        raise RuntimeError("No model versions found in S3 and no valid local brain.")

    current_v = 0
    if os.path.exists(VERSION_FILE):
        with open(VERSION_FILE) as f:
            line = f.read().strip()
            current_v = int(line) if line.isdigit() else 0

    latest_v = versions[0][0]

    for version_num, s3_key in versions:
        label = f"v{version_num}"

        # Fast path: already installed and valid
        if version_num == current_v and os.path.isdir(LOCAL_BRAIN_DIR):
            print(f"--- [BRAIN] Checking installed {label} ---")
            if _validate_brain(LOCAL_BRAIN_DIR):
                if version_num == latest_v:
                    print(f"--- [BRAIN] {label} is current and validated ---")
                else:
                    print(f"--- [FALLBACK] Running on {label} (newer versions unavailable) ---")
                return version_num
            else:
                print(f"--- [BRAIN] Installed {label} failed validation — downloading fresh copy ---")

        # Download and validate in temp dir
        print(f"--- [BRAIN] Downloading {label} from S3 ---")
        try:
            _download_and_extract(s3, s3_key, _TEMP_BRAIN_DIR)
        except Exception as exc:
            print(f"  [WARN] Download failed for {label}: {exc}")
            if os.path.exists(_TEMP_BRAIN_DIR):
                shutil.rmtree(_TEMP_BRAIN_DIR)
            continue

        if _validate_brain(_TEMP_BRAIN_DIR):
            _install_brain(_TEMP_BRAIN_DIR, version_num)
            if version_num == latest_v:
                if version_num > current_v:
                    print(f"--- [BRAIN SWAP] Upgraded: v{current_v} → v{version_num} ---")
                else:
                    print(f"--- [BRAIN] Re-installed {label} (passed validation) ---")
            else:
                print(f"--- [FALLBACK] Rolled back to {label} "
                      f"(v{latest_v} through v{version_num + 1} all failed validation) ---")
            return version_num
        else:
            print(f"  [WARN] {label} failed validation — trying next older version")
            if os.path.exists(_TEMP_BRAIN_DIR):
                shutil.rmtree(_TEMP_BRAIN_DIR)

    raise RuntimeError(
        f"All {len(versions)} model version(s) failed validation. "
        "Check model artifacts in S3 before retrying."
    )


# ---------------------------------------------------------------------------
# SageMaker endpoint helpers
# ---------------------------------------------------------------------------

def _endpoint_available(endpoint_name: str) -> bool:
    """Returns True if the named SageMaker endpoint exists and is InService."""
    try:
        sm     = boto3.client("sagemaker")
        status = sm.describe_endpoint(EndpointName=endpoint_name)["EndpointStatus"]
        return status == "InService"
    except Exception:
        return False


def _score_via_endpoint(
    X_raw: np.ndarray,
    feature_names: list,
    endpoint_name: str,
) -> tuple:
    """
    Sends all session feature vectors to the SageMaker endpoint in a single
    batch request and returns (scores, ae_mse, if_raw) as numpy arrays.

    The endpoint (serve.py) accepts a JSON array and returns a list of result
    dicts: [{"frustrationScore": ..., "breakdown": {"ae_mse": ..., "if_score": ...}}, ...]
    """
    runtime = boto3.client("sagemaker-runtime")
    payload = [
        {name: float(val) for name, val in zip(feature_names, row)}
        for row in X_raw
    ]
    response = runtime.invoke_endpoint(
        EndpointName=endpoint_name,
        ContentType="application/json",
        Body=json.dumps(payload),
    )
    results = json.loads(response["Body"].read())

    # Endpoint returns a single dict when only one session was sent
    if isinstance(results, dict):
        results = [results]

    scores = np.array([r["frustrationScore"] for r in results])
    ae_mse = np.array([r["breakdown"]["ae_mse"]   for r in results])
    if_raw = np.array([r["breakdown"]["if_score"]  for r in results])
    return scores, ae_mse, if_raw


def get_next_run_number() -> int:
    """
    Scans S3 results prefix to determine the next sequential run number.
    Returns 1 on first ever run.
    """
    s3 = boto3.client('s3')
    response = s3.list_objects_v2(Bucket=BUCKET_NAME, Prefix=S3_RESULTS_PREFIX)
    run_numbers = [0]
    if 'Contents' in response:
        for obj in response['Contents']:
            match = re.search(r'run(\d+)_', obj['Key'])
            if match:
                run_numbers.append(int(match.group(1)))
    return max(run_numbers) + 1


def build_version_tag(model_version: int, run_number: int) -> str:
    """
    Returns a human-readable version tag for output filenames.

    Format:  model_v{N}_run{RRR}_{YYYYMMDD}_{HHMM}
    Example: model_v3_run007_20260411_1423
    """
    ts = datetime.now().strftime("%Y%m%d_%H%M")
    return f"model_v{model_version}_run{run_number:03d}_{ts}"


# ---------------------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------------------

def _save_locally(df: pd.DataFrame, local_dir: str, filename: str) -> str:
    """Writes df to local_dir/filename and returns the full path."""
    os.makedirs(local_dir, exist_ok=True)
    local_path = os.path.join(local_dir, filename)
    df.to_csv(local_path, index=False)
    return local_path


def _upload_to_s3(local_path: str, s3_prefix: str, filename: str) -> str:
    """Uploads a local file to S3 and returns the s3:// URI."""
    s3 = boto3.client('s3')
    s3_key = f"{s3_prefix}/{filename}"
    s3.upload_file(local_path, BUCKET_NAME, s3_key)
    return f"s3://{BUCKET_NAME}/{s3_key}"


def save_output(
    df: pd.DataFrame,
    local_dir: str,
    s3_prefix: str,
    filename: str,
    local_only: bool,
) -> None:
    """
    Saves df locally and — unless local_only is True — also uploads to S3.

    Default (local_only=False): writes to disk AND uploads to S3.
    With --local-only:           writes to disk only (no S3 upload).
    """
    local_path = _save_locally(df, local_dir, filename)
    print(f"  [LOCAL]  {local_path}")

    if not local_only:
        s3_uri = _upload_to_s3(local_path, s3_prefix, filename)
        print(f"  [S3]     {s3_uri}")


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def run_synchronized_inference(
    raw_data_path: str,
    schema_path: str = None,
    local_only: bool = False,
    endpoint_name: str = None,
    update_endpoint: bool = False,
) -> None:
    """
    Full end-to-end pipeline:
      1. Brain Swap   — sync latest model from S3 (with automatic fallback)
      2. Preprocess   — load raw telemetry, aggregate sessions, extract features
      3. Score        — via SageMaker endpoint if available, else local 2-model ensemble
      4. Persist      — save features + predictions locally (and to S3 by default)

    Parameters
    ----------
    raw_data_path   : S3 URI or local path to raw NDJSON/CSV telemetry
    schema_path     : Optional path to platform schema JSON
    local_only      : If True, skip S3 upload (useful for local testing)
    endpoint_name   : SageMaker endpoint name to use for scoring.
                      Falls back to local model if endpoint is unavailable.
                      Pass None (default) to always score locally.
    update_endpoint : If True, trigger a SageMaker endpoint update to the
                      latest model version before scoring. Requires endpoint_name.
    """

    # ------------------------------------------------------------------
    # Step 1 — Brain Swap (always run — keeps local weights current as fallback)
    # ------------------------------------------------------------------
    model_version = sync_brain()
    run_number    = get_next_run_number() if not local_only else 0
    version_tag   = build_version_tag(model_version, run_number)

    # Optionally update the SageMaker endpoint with the latest model version
    if update_endpoint and endpoint_name:
        print(f"\nUpdating endpoint '{endpoint_name}' to model v{model_version}...")
        import deploy_endpoint as dep
        import sagemaker, boto3
        from config import SAGEMAKER_REGION
        sm_session = sagemaker.Session(boto_session=boto3.Session(region_name=SAGEMAKER_REGION))
        s3_client  = boto3.client("s3", region_name=SAGEMAKER_REGION)
        _, model_uri = dep.get_latest_model_version(s3_client)
        dep.deploy_or_update(
            model_version=model_version,
            model_uri=model_uri,
            endpoint_name=endpoint_name,
            sm_session=sm_session,
            role=dep.get_execution_role(sm_session),
        )

    # Determine scoring mode
    use_endpoint = endpoint_name and _endpoint_available(endpoint_name)
    scoring_mode = f"endpoint:{endpoint_name}" if use_endpoint else f"local:v{model_version}"
    if endpoint_name and not use_endpoint:
        print(f"  [WARN] Endpoint '{endpoint_name}' is not InService — falling back to local scoring.")

    print(f"\n{'='*60}")
    print(f"  Inference Run  :  {version_tag}")
    print(f"  Model version  :  v{model_version}")
    print(f"  Run number     :  {run_number:03d}")
    print(f"  Input          :  {raw_data_path}")
    print(f"  Scoring mode   :  {scoring_mode}")
    print(f"  Save mode      :  {'local only' if local_only else 'local + S3'}")
    print(f"{'='*60}\n")

    # ------------------------------------------------------------------
    # Step 2 — Load local model artifacts (always loaded as fallback)
    # ------------------------------------------------------------------
    print("Loading local model artifacts (fallback)...")
    ae         = tf.keras.models.load_model(os.path.join(LOCAL_BRAIN_DIR, "autoencoder_model.keras"))
    iso_forest = joblib.load(os.path.join(LOCAL_BRAIN_DIR, "isolation_forest.pkl"))
    scaler     = joblib.load(os.path.join(LOCAL_BRAIN_DIR, "scaler.pkl"))
    metadata   = joblib.load(os.path.join(LOCAL_BRAIN_DIR, "model_metadata.joblib"))
    print(f"  [OK] Local artifacts ready (AE + Isolation Forest)")

    # ------------------------------------------------------------------
    # Step 3 — Preprocess (inline — no subprocess)
    # ------------------------------------------------------------------
    print("\nPreprocessing telemetry...")
    schema     = prep.load_schema(schema_path)
    loader     = prep.S3DataLoader(source=raw_data_path, schema=schema)
    raw_events = loader.fetchRawLogs()
    if not raw_events:
        raise RuntimeError(f"No telemetry events loaded from: {raw_data_path}")

    aggregator = prep.SessionAggregator()
    aggregator.ingest_many(raw_events)
    sessions = aggregator.groupBySession()
    if not sessions:
        raise RuntimeError("No sessions formed. Check sessionId field in telemetry data.")

    X_raw, feature_names, session_ids, timestamps, user_ids = prep.build_feature_matrix(
        sessions, prep.FeatureExtractor(do_normalize=False, schema=schema)
    )
    print(f"  [OK] {len(raw_events)} events → {len(session_ids)} sessions → feature matrix {X_raw.shape}")

    # ------------------------------------------------------------------
    # Step 4 — Score sessions
    #   Primary  : SageMaker endpoint (if available)
    #   Fallback : local 2-model ensemble (AE + Isolation Forest)
    # ------------------------------------------------------------------
    print(f"\nScoring sessions via {scoring_mode}...")
    if use_endpoint:
        try:
            score_10, ae_mse, if_raw = _score_via_endpoint(X_raw, feature_names, endpoint_name)
            print(f"  [OK] Endpoint returned scores for {len(score_10)} sessions")
        except Exception as exc:
            print(f"  [WARN] Endpoint call failed ({exc}) — falling back to local scoring.")
            use_endpoint = False

    if not use_endpoint:
        X_scaled      = scaler.transform(X_raw).astype(np.float32)
        reconstructed = ae.predict(X_scaled, verbose=0)
        ae_mse        = np.mean(np.square(X_scaled - reconstructed), axis=1)
        if_raw        = iso_forest.decision_function(X_scaled)
        ae_term       = np.clip(10 * ae_mse / 0.05,        0, 10)
        if_term       = np.clip(10 * (0.1 - if_raw) / 0.2, 0, 10)
        score_10      = (ae_term + if_term) / 2.0

    print(f"  [OK] Scored {len(score_10)} sessions | "
          f"mean={np.mean(score_10):.2f}  max={np.max(score_10):.2f}")

    # ------------------------------------------------------------------
    # Step 5 — Build output DataFrames
    # ------------------------------------------------------------------
    df_features = pd.DataFrame({
        "sessionId": session_ids,
        "userId":    user_ids,
        "timestamp": timestamps,
        **{name: X_raw[:, i] for i, name in enumerate(feature_names)},
    })

    df_predictions = pd.DataFrame({
        "sessionId":       session_ids,
        "userId":          user_ids,
        "timestamp":       timestamps,
        "frustrationScore": np.round(score_10, 2),
        "severity":        [calculate_severity(s) for s in score_10],
        "ae_mse":          np.round(ae_mse, 6),
        "if_score":        np.round(if_raw, 6),
        "model_version":   f"v{model_version}",
        "scoring_mode":    scoring_mode,
        "run_tag":         version_tag,
    })

    # ------------------------------------------------------------------
    # Step 6 — Save (local always; S3 unless --local-only)
    # ------------------------------------------------------------------
    print("\nSaving outputs...")
    save_output(
        df=df_features,
        local_dir=LOCAL_PREPROCESSED_DIR,
        s3_prefix=S3_PREPROCESSED_PREFIX,
        filename=f"features_{version_tag}.csv",
        local_only=local_only,
    )
    save_output(
        df=df_predictions,
        local_dir=LOCAL_OUTPUT_DIR,
        s3_prefix=S3_RESULTS_PREFIX,
        filename=f"predictions_{version_tag}.csv",
        local_only=local_only,
    )

    print(f"\n{'='*60}")
    print(f"  [SUCCESS] {version_tag} complete")
    print(f"{'='*60}\n")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Telemetry Frustration Scoring — end-to-end inference pipeline"
    )
    parser.add_argument(
        "--input", type=str, required=True,
        help="S3 URI or local path to raw NDJSON/CSV telemetry data"
    )
    parser.add_argument(
        "--schema", type=str, default=None,
        help="Path to platform schema JSON (default: config/schema_default.json)"
    )
    parser.add_argument(
        "--local-only", action="store_true",
        help="Save output files locally only; skip S3 upload (useful for testing)"
    )
    parser.add_argument(
        "--endpoint-name", type=str, default=SAGEMAKER_ENDPOINT_NAME,
        help=(
            "SageMaker endpoint name for scoring. "
            "Falls back to local model if endpoint is not InService. "
            f"(default: {SAGEMAKER_ENDPOINT_NAME})"
        )
    )
    parser.add_argument(
        "--no-endpoint", action="store_true",
        help="Skip endpoint check and always score locally (overrides --endpoint-name)"
    )
    parser.add_argument(
        "--update-endpoint", action="store_true",
        help=(
            "Before scoring, update the SageMaker endpoint to the latest model version. "
            "Only runs if --endpoint-name is set and --no-endpoint is not set."
        )
    )
    args = parser.parse_args()

    run_synchronized_inference(
        raw_data_path=args.input,
        schema_path=args.schema,
        local_only=args.local_only,
        endpoint_name=None if args.no_endpoint else args.endpoint_name,
        update_endpoint=args.update_endpoint,
    )
