import numpy as np


def calculate_severity(score: float) -> str:
    """Maps a 0-10 frustration score to a human-readable severity label."""
    if score >= 9.0:
        return 'High'
    elif score >= 7.0:
        return 'Medium'
    else:
        return 'Normal'


def compute_frustration_score(ae_mse, if_raw, gmm_raw) -> np.ndarray:
    """
    3-model ensemble frustration score on a 0-10 scale.

    Parameters
    ----------
    ae_mse  : per-sample MSE from the Autoencoder reconstruction (higher = more anomalous)
    if_raw  : raw decision_function output from sklearn IsolationForest (lower = more anomalous)
    gmm_raw : negated log-likelihood — caller must pass -gmm_model.score_samples(X)
              so that higher values = more anomalous (consistent direction with ae_mse/if_raw)

    Returns
    -------
    np.ndarray of float, each value in [0, 10]
    """
    ae_term  = np.clip(10 * ae_mse / 0.05,        0, 10)
    if_term  = np.clip(10 * (0.1 - if_raw) / 0.2, 0, 10)
    gmm_term = np.clip(10 * gmm_raw / 5.0,         0, 10)
    return (ae_term + if_term + gmm_term) / 3.0
