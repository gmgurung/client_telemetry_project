import json
import os
import joblib
import numpy as np
import pandas as pd
import requests


def _calculate_severity(score: float) -> str:
    if score >= 9.0:
        return "High"
    elif score >= 7.0:
        return "Medium"
    return "Normal"


def _compute_frustration_score(ae_mse: np.ndarray, if_raw: np.ndarray) -> np.ndarray:
    ae_term = np.clip(10 * ae_mse / 0.05, 0, 10)
    if_term = np.clip(10 * (0.1 - if_raw) / 0.2, 0, 10)
    return (ae_term + if_term) / 2.0


def _load_artifacts():
    model_dir = "/opt/ml/model"
    isolation_forest = joblib.load(os.path.join(model_dir, "code", "isolation_forest.pkl"))
    scaler = joblib.load(os.path.join(model_dir, "code", "scaler.pkl"))
    metadata = joblib.load(os.path.join(model_dir, "code", "model_metadata.joblib"))
    return isolation_forest, scaler, metadata


def handler(data, context):
    if context.request_content_type != "application/json":
        raise ValueError(
            f"Unsupported content type: {context.request_content_type}. Expected application/json"
        )

    payload = json.loads(data.read().decode("utf-8"))
    if isinstance(payload, list):
        df = pd.DataFrame(payload)
    else:
        df = pd.DataFrame([payload])

    isolation_forest, scaler, metadata = _load_artifacts()

    features = df[metadata["feature_names"]]
    X_scaled = scaler.transform(features).astype(np.float32)

    # 调 TensorFlow Serving
    instances = X_scaled.tolist()
    tf_payload = json.dumps({"instances": instances})

    response = requests.post(
        context.rest_uri,
        data=tf_payload,
        headers={"Content-Type": "application/json"},
    )
    response.raise_for_status()

    tf_result = response.json()

    # TensorFlow Serving 通常返回 predictions
    reconstructed = np.array(tf_result["predictions"], dtype=np.float32)

    ae_mse = np.mean(np.square(X_scaled - reconstructed), axis=1)
    if_raw = isolation_forest.decision_function(X_scaled)
    scores = _compute_frustration_score(ae_mse, if_raw)

    results = []
    for i in range(len(scores)):
        results.append({
            "frustrationScore": round(float(scores[i]), 2),
            "severity": _calculate_severity(float(scores[i])),
            "breakdown": {
                "ae_mse": float(ae_mse[i]),
                "if_score": float(if_raw[i]),
            },
        })

    output = results[0] if len(results) == 1 else results
    return json.dumps(output), context.accept_header