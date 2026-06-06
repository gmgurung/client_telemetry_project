# Telemetry Frustration Scoring Pipeline Visualization

This document provides a clean, modern, and sectionalized view of the machine learning pipeline for session-level frustration scoring.

## 🏗️ Pipeline Overview

```mermaid
graph TD
    subgraph Data_Ingestion ["1. Data Ingestion & Preprocessing"]
        A[Raw Telemetry .ndjson] -->|S3/Local| B(preprocess.py)
        B --> C{Feature Engineering}
        C --> D[Features .csv]
        C --> E[(PostgreSQL RDS)]
        B -->|Schema| F[config/schema_default.json]
    end

    subgraph Model_Training ["2. Model Training & Artifacts"]
        D --> G(train.py)
        G -->|Trains| H[Autoencoder]
        G -->|Trains| I[Isolation Forest]
        G -->|Fits| J[StandardScaler]
        H & I & J --> K{Validation}
        K -->|Pass| L[model_metadata.joblib]
        L --> M[Versioned Tarball model_vX.tar.gz]
        M -->|Upload| N[AWS S3 Model Bucket]
    end

    subgraph Deployment ["3. Endpoint Deployment"]
        N --> O(package.py)
        O -->|Convert to SavedModel| P[TF SavedModel '1/']
        O -->|Bundle code| Q[code/inference.py]
        P & Q --> R[Deployment Tarball]
        R --> S(deploy_endpoint.py)
        S --> T[SageMaker Real-Time Endpoint]
    end

    subgraph Inference_Workflows ["4. Inference Workflows"]
        direction LR
        subgraph Automated_Polling
            U[S3 Raw Data] --> V(polling_runner.py)
            V --> W(client.py)
        end
        subgraph Automated_Trigger
            U --> X(lambda_function.py)
            X --> T
        end
        subgraph Manual_CLI
            Y[CLI User] --> W
        end
        W -->|Inference Request| T
        W -->|Local Scoring| Z[Local Artifacts Sync]
    end

    subgraph Scoring_Logic ["5. Scoring & Results"]
        T --> AA(serve.py / inference.py)
        AA --> BB{Ensemble Scoring}
        BB -->|AE Error + IF Score| CC[Frustration Score 0-10]
        CC --> DD(utils.py)
        DD --> EE[Severity Classification]
        EE --> FF[Normal / Medium / High]
    end

    %% Styling
    classDef ingestion fill:#e1f5fe,stroke:#01579b,stroke-width:2px;
    classDef training fill:#f3e5f5,stroke:#4a148c,stroke-width:2px;
    classDef deployment fill:#fff3e0,stroke:#e65100,stroke-width:2px;
    classDef inference fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px;
    classDef scoring fill:#fbe9e7,stroke:#bf360c,stroke-width:2px;

    class A,B,C,D,E,F ingestion;
    class G,H,I,J,K,L,M,N training;
    class O,P,Q,R,S,T deployment;
    class U,V,W,X,Y,Z inference;
    class AA,BB,CC,DD,EE,FF scoring;
```

---

## 📂 Component Breakdown

### 1. Data Ingestion & Preprocessing
*   **`preprocess.py`**: The entry point for data. It aggregates raw telemetry events into session-level features.
*   **`config/schema_default.json`**: Defines how telemetry events are mapped to numerical features.
*   **Storage**: Features can be saved as CSV for training or pushed to a **PostgreSQL RDS** instance for long-term analytics.

### 2. Model Training & Artifacts
*   **`train.py`**: Trains the ensemble model (Autoencoder + Isolation Forest).
*   **Validation**: Before any model is uploaded, it must pass a battery of tests (finite scores, discrimination check, range check).
*   **Artifacts**: Versioned models are stored in S3 as `model_vX.tar.gz`.

### 3. Endpoint Deployment
*   **`package.py`**: Prepares artifacts for SageMaker. It converts Keras models to TensorFlow's `SavedModel` format and bundles the inference logic.
*   **`deploy_endpoint.py`**: Provisions the infrastructure (AWS SageMaker) to host the model for real-time requests.

### 4. Inference Workflows
*   **`polling_runner.py` / `scheduler.py`**: Continuously monitors S3 for new data and triggers inference.
*   **`client.py`**: A versatile tool that can perform local scoring (using synced artifacts) or call the SageMaker endpoint.
*   **`lambda_function.py`**: Provides a serverless trigger mechanism for event-driven inference.

### 5. Scoring & Results
*   **`serve.py` / `inference.py`**: The logic running inside the SageMaker container.
*   **`utils.py`**: Shared logic for calculating the final 0-10 Frustration Score and determining severity.
*   **Severity**: Sessions are categorized as **Normal (<7)**, **Medium (7-9)**, or **High (≥9)**.

---

## 📐 Component UML Diagrams

This section provides a structural view of the key Python components, showing their internal class hierarchies, field-level data structures, and explicit method signatures.

### 1. Data Structures (`preprocess.py`)
These classes define the data contract as it flows through the pipeline.

```mermaid
classDiagram
    class TelemetryEvent {
        +sessionId: str
        +timestamp: datetime
        +eventType: str
        +pageRoute: str?
        +userId: str?
        +url: str?
        +elementId: str?
        +metadata: dict?
        +raw: dict?
    }
    class SessionData {
        +sessionId: str
        +events: List~TelemetryEvent~
        +startTime: datetime
        +endTime: datetime
        +duration_ms: float
    }
    class FeatureVector {
        +vector: List~float~
        +featureNames: List~str~
        +isValid: bool
        +validate() void
    }
```

### 2. Preprocessing & Transformation (`preprocess.py`)
Explicit mapping of data ingestion and feature engineering.

```mermaid
classDiagram
    class DataLoader {
        <<abstract>>
        +schema: dict
        +fetchRawLogs(max_events: int?) List~TelemetryEvent~
        #_resolve_field(obj: dict, canonical: str) Any
        #_to_event(obj: dict) TelemetryEvent?
    }
    class S3DataLoader {
        +source: str (S3 URI or Local Path)
        +aws_region: str?
        +fetchRawLogs(max_events: int?) List~TelemetryEvent~
    }
    class SessionAggregator {
        -by_session: Dict~str, List~TelemetryEvent~~
        +ingest(event: TelemetryEvent) void
        +ingest_many(events: Iterable~TelemetryEvent~) void
        +groupBySession() List~SessionData~
    }
    class FeatureExtractor {
        +do_normalize: bool
        +normalize_method: str ("zscore" | "minmax")
        +createFeatureVector(session: SessionData) FeatureVector
        +normalize(X: np.ndarray, names: List~str~) np.ndarray
        +fit_normalize(X: np.ndarray, names: List~str~) dict
    }
    
    note for FeatureExtractor "Engineers 13 Features:\nevent_count, page_view_count, unique_route_count,\nclick_count, field_change_count, flow_success_count,\nflow_failure_count, error_event_count, retry_count,\nrage_click_count, session_duration_ms, total_dwell_ms,\navg_inter_event_gap_ms"

    DataLoader <|-- S3DataLoader
    SessionAggregator o-- TelemetryEvent
    FeatureExtractor ..> SessionData : Transforms
    FeatureExtractor ..> FeatureVector : Produces
```

### 3. Inference Orchestration (`client.py`)
Coordinates local scoring and SageMaker interactions.

```mermaid
classDiagram
    class InferenceOrchestrator {
        +run_synchronized_inference(input: str, schema: str?, local_only: bool) void
        +sync_brain() int (Returns Version)
    }
    class BrainManager {
        +LOCAL_BRAIN_DIR: str ("./current_brain")
        +VERSION_FILE: str ("current_version.txt")
        +validate_brain(dir: str) bool
        +install_brain(src: str, version: int) void
        +download_and_extract(s3: boto3.client, key: str, dest: str) void
    }
    class EndpointClient {
        +score_via_endpoint(X: np.ndarray, names: List~str~, endpoint: str) Tuple~np.ndarray, np.ndarray, np.ndarray~
        +endpoint_available(name: str) bool
    }

    InferenceOrchestrator ..> BrainManager : Syncs Local Assets
    InferenceOrchestrator ..> EndpointClient : Calls API
```

### 4. SageMaker Interface (`serve.py` / `inference.py`)
Internal logic for the SageMaker Inference Container.

```mermaid
classDiagram
    class SageMakerInference {
        +model_fn(model_dir: str) dict (Loads AE, IF, Scaler)
        +input_fn(body: str, type: str) DataFrame
        +predict_fn(input: DataFrame, models: dict) List~dict~
        +output_fn(prediction: list, accept: str) Tuple~str, str~
    }
    class ScoringLogic {
        +compute_frustration_score(ae_mse: np.ndarray, if_raw: np.ndarray) np.ndarray
        +calculate_severity(score: float) str ("Normal" | "Medium" | "High")
    }

    SageMakerInference ..> ScoringLogic : Computes
```

---
*Visualization generated by Gemini CLI*
