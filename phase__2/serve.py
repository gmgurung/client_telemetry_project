import os
import json
import joblib
import numpy as np
import pandas as pd
import tensorflow as tf


# ---------------------------------------------------------------------------
# Scoring helpers (inlined — serve.py must be self-contained for SageMaker)
# ---------------------------------------------------------------------------

def _calculate_severity(score: float) -> str:
    if score >= 9.0:
        return "High"
    elif score >= 7.0:
        return "Medium"
    return "Normal"


def _compute_frustration_score(ae_mse: np.ndarray, if_raw: np.ndarray) -> np.ndarray:
    """2-model ensemble: Autoencoder + Isolation Forest, equal weighting."""
    ae_term = np.clip(10 * ae_mse / 0.05,        0, 10)
    if_term = np.clip(10 * (0.1 - if_raw) / 0.2, 0, 10)
    return (ae_term + if_term) / 2.0


# ---------------------------------------------------------------------------
# SageMaker inference API
# ---------------------------------------------------------------------------

def model_fn(model_dir):
    """Load model artifacts from model_dir (extracted from the tarball)."""
    print("Loading Autoencoder...")
    ae_model = tf.keras.models.load_model(os.path.join(model_dir, "autoencoder_model.keras"))

    print("Loading Isolation Forest...")
    isolation_forest = joblib.load(os.path.join(model_dir, "isolation_forest.pkl"))

    print("Loading Scaler...")
    scaler = joblib.load(os.path.join(model_dir, "scaler.pkl"))

    print("Loading Metadata...")
    metadata = joblib.load(os.path.join(model_dir, "model_metadata.joblib"))

    return {
        "ae_model":         ae_model,
        "isolation_forest": isolation_forest,
        "scaler":           scaler,
        "metadata":         metadata,
    }


def input_fn(request_body, request_content_type):
    """
    Deserialise the request body.

    Accepts either:
      - A single feature dict  → {"event_count": 5, "page_view_count": 3, ...}
      - A list of feature dicts for batch scoring → [{...}, {...}, ...]
    """
    if request_content_type != "application/json":
        raise ValueError(
            f"Unsupported content type: {request_content_type}. Expected 'application/json'."
        )
    data = json.loads(request_body)
    if isinstance(data, list):
        return pd.DataFrame(data)
    return pd.DataFrame([data])


def predict_fn(input_data: pd.DataFrame, model_dict: dict) -> list:
    """
    Score one or more sessions with the 2-model ensemble and return a list
    of result dicts (one per session), suitable for JSON serialisation.
    """
    ae_model         = model_dict["ae_model"]
    isolation_forest = model_dict["isolation_forest"]
    scaler           = model_dict["scaler"]
    metadata         = model_dict["metadata"]

    features = input_data[metadata["feature_names"]]
    X_scaled = scaler.transform(features).astype(np.float32)

    reconstructed = ae_model.predict(X_scaled, verbose=0)
    ae_mse        = np.mean(np.square(X_scaled - reconstructed), axis=1)
    if_raw        = isolation_forest.decision_function(X_scaled)
    scores        = _compute_frustration_score(ae_mse, if_raw)

    results = []
    for i in range(len(scores)):
        results.append({
            "frustrationScore": round(float(scores[i]), 2),
            "severity":         _calculate_severity(float(scores[i])),
            "breakdown": {
                "ae_mse":   float(ae_mse[i]),
                "if_score": float(if_raw[i]),
            },
        })

    # Return unwrapped dict if single session was sent
    return results[0] if len(results) == 1 else results


def output_fn(prediction, accept):
    if accept != "application/json":
        raise ValueError(f"Accept header must be 'application/json', got: {accept}")
    return json.dumps(prediction), accept
