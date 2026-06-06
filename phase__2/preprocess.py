#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Junkai_version_3 (adds timestamp output + automatic train/test split & S3 upload)

"""
preprocessing.py
Raw telemetry (NDJSON / JSONL) -> session-level feature vectors.

Implements:
- S3DataLoader: fetchRawLogs() to load TelemetryEvent objects from local paths or S3 URIs
- SessionAggregator: ingest(), groupBySession() to build SessionData
- FeatureExtractor: normalize(), encodeCategorical(), createFeatureVector()

Outputs:
- feature_vector.csv (default) OR feature_vector.npy
- feature_names.json (always)
- normalization_stats.json (when normalization enabled)
- timestamps.json (when output is .npy and include_timestamp enabled)
- train.csv and test.csv (automatically uploaded to S3)

Designed to run in SageMaker Processing Job:
- Input:  /opt/ml/processing/input   (or any provided path)
- Output: /opt/ml/processing/output  (or any provided path)
"""

from __future__ import annotations

import os
import re
import csv
import io
import json
import math
import argparse
import boto3
import sagemaker
from dataclasses import dataclass, asdict
from typing import Any, Dict, Iterable, List, Optional, Tuple
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from abc import ABC, abstractmethod
from config import MODEL_BUCKET, RDS_HOST, RDS_PORT, RDS_DB, RDS_USER, RDS_PASSWORD, RDS_TABLE


_DEFAULT_SCHEMA: Dict[str, Any] = {
    "platform": "web",
    "field_aliases": {
        "sessionId":  ["sessionId", "sessionID", "session_id"],
        "timestamp":  ["timestamp", "time", "ts"],
        "eventType":  ["eventType", "event_type", "type"],
        "pageRoute":  ["pageRoute", "page_route", "route"],
        "userId":     ["userId", "user_id", "uid"],
        "elementId":  ["elementId", "element_id"],
    },
    "event_types": {
        "page_view":     ["page_view"],
        "click":         ["cta_click", "nav_click", "statements_click"],
        "field_change":  ["field_change"],
        "flow_complete": ["flow_complete"],
        "error":         ["trade_step_error"],
        "retry":         ["retry_attempt"],
        "rage_click":    ["rage_click"],
        "page_view_end": ["page_view_end"],
    },
}


def load_schema(schema_path: Optional[str] = None) -> Dict[str, Any]:
    """Load a platform schema JSON.

    Resolution order:
    1. ``schema_path`` if explicitly provided.
    2. ``config/schema_default.json`` next to this file, if it exists.
    3. Built-in ``_DEFAULT_SCHEMA`` as a final fallback (no file required).
    """
    if schema_path is not None:
        with open(schema_path, "r", encoding="utf-8") as f:
            return json.load(f)
    here = os.path.dirname(os.path.abspath(__file__))
    default_path = os.path.join(here, "config", "schema_default.json")
    if os.path.exists(default_path):
        with open(default_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return _DEFAULT_SCHEMA


# -----------------------------
# Data Schema
# -----------------------------

@dataclass
class TelemetryEvent:
    sessionId: str
    timestamp: datetime
    eventType: str
    pageRoute: Optional[str] = None
    userId: Optional[str] = None
    url: Optional[str] = None
    elementId: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    raw: Optional[Dict[str, Any]] = None  # keep original for debugging


@dataclass
class SessionData:
    sessionId: str
    events: List[TelemetryEvent]
    startTime: datetime
    endTime: datetime

    @property
    def duration_ms(self) -> float:
        return max(0.0, (self.endTime - self.startTime).total_seconds() * 1000.0)


@dataclass
class FeatureVector:
    vector: List[float]
    featureNames: List[str]
    isValid: bool = True

    def validate(self) -> None:
        if len(self.vector) != len(self.featureNames):
            raise ValueError(
                f"Feature length mismatch: len(vector)={len(self.vector)} "
                f"!= len(featureNames)={len(self.featureNames)}"
            )
        # ensure float + finite
        for i, v in enumerate(self.vector):
            if not isinstance(v, (float, int, np.floating, np.integer)):
                raise TypeError(f"Feature '{self.featureNames[i]}' is not numeric: {type(v)}")
            if isinstance(v, (float, np.floating)) and (math.isnan(float(v)) or math.isinf(float(v))):
                raise ValueError(f"Feature '{self.featureNames[i]}' is NaN/Inf: {v}")


# -----------------------------
# Utilities
# -----------------------------

_ISO_Z_RE = re.compile(r"Z$")


def parse_ts(ts: Any) -> datetime:
    """
    Accepts ISO strings like '2026-02-11T22:49:47.026Z' or without Z.
    Falls back to UTC if timezone missing.
    """
    if ts is None:
        return datetime.now(timezone.utc)

    if isinstance(ts, datetime):
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)

    s = str(ts).strip()
    s = _ISO_Z_RE.sub("+00:00", s)  # replace trailing Z
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        dt = pd.to_datetime(s, utc=True).to_pydatetime()

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def is_s3_uri(path: str) -> bool:
    return path.startswith("s3://")

def list_input_files(input_path: str, exts: Tuple[str, ...] = (".jsonl", ".ndjson", ".txt", ".log", ".csv")) -> List[str]:
    if os.path.isfile(input_path):
        return [input_path]

    files: List[str] = []
    for root, _, fnames in os.walk(input_path):
        for f in fnames:
            if f.lower().endswith(exts):
                files.append(os.path.join(root, f))
    files.sort()
    return files

# -----------------------------
# 1) Data Ingestion
# -----------------------------

class DataLoader(ABC):
    """Abstract base for all telemetry loaders."""

    def __init__(self, schema: Optional[Dict[str, Any]] = None):
        self._schema = schema or load_schema()

    @abstractmethod
    def fetchRawLogs(self, max_events: Optional[int] = None) -> List[TelemetryEvent]: ...

    def _resolve_field(self, obj: Dict[str, Any], canonical: str) -> Any:
        """Look up a field by its canonical name using schema aliases."""
        for alias in self._schema.get("field_aliases", {}).get(canonical, [canonical]):
            if alias in obj and obj[alias] is not None:
                return obj[alias]
        return None

    def _to_event(self, obj: Dict[str, Any]) -> Optional[TelemetryEvent]:
        session_id = self._resolve_field(obj, "sessionId")
        ts_raw     = self._resolve_field(obj, "timestamp")
        event_type = self._resolve_field(obj, "eventType")
        if not session_id or not ts_raw or not event_type:
            return None
        return TelemetryEvent(
            sessionId=str(session_id),
            timestamp=parse_ts(ts_raw),
            eventType=str(event_type),
            pageRoute=self._resolve_field(obj, "pageRoute"),
            userId=self._resolve_field(obj, "userId"),
            url=obj.get("url"),
            elementId=self._resolve_field(obj, "elementId"),
            metadata=obj.get("metadata") if isinstance(obj.get("metadata"), dict) else None,
            raw=obj,
        )


class InMemoryDataLoader(DataLoader):
    """Loads TelemetryEvents from a list of dicts already in memory."""

    def __init__(self, events: List[Dict[str, Any]], schema: Optional[Dict[str, Any]] = None):
        super().__init__(schema=schema)
        self._events = events

    def fetchRawLogs(self, max_events: Optional[int] = None) -> List[TelemetryEvent]:
        result: List[TelemetryEvent] = []
        for obj in self._events:
            ev = self._to_event(obj)
            if ev is not None:
                result.append(ev)
            if max_events and len(result) >= max_events:
                break
        return result


class S3DataLoader(DataLoader):
    """
    Loads telemetry events from:
    - Local files/dirs (NDJSON/JSONL/CSV)
    - S3 URIs (s3://bucket/prefix or s3://bucket/key)
    """

    def __init__(self, source: str, aws_region: Optional[str] = None,
                 schema: Optional[Dict[str, Any]] = None):
        super().__init__(schema=schema)
        self.source = source
        self.aws_region = aws_region

    def fetchRawLogs(self, max_events: Optional[int] = None) -> List[TelemetryEvent]:
        if is_s3_uri(self.source):
            return self._fetch_from_s3(max_events=max_events)
        return self._fetch_from_local(max_events=max_events)

    def _process_row(self, row_obj: Dict[str, Any], events_list: List[TelemetryEvent]):
        """Helper to parse stringified metadata from CSVs and append to events."""
        # If metadata is a string (common in CSVs), try to parse it into a dict
        if isinstance(row_obj.get('metadata'), str) and row_obj['metadata'].strip():
            try:
                row_obj['metadata'] = json.loads(row_obj['metadata'])
            except json.JSONDecodeError:
                pass # If it fails, leave it as is
                
        ev = self._to_event(row_obj)
        if ev is not None:
            events_list.append(ev)

    def _fetch_from_local(self, max_events: Optional[int] = None) -> List[TelemetryEvent]:
        files = list_input_files(self.source)
        if not files:
            raise FileNotFoundError(f"No supported logs found under: {self.source}")

        events: List[TelemetryEvent] = []
        for fp in files:
            is_csv = fp.lower().endswith('.csv')
            with open(fp, "r", encoding="utf-8") as f:
                if is_csv:
                    reader = csv.DictReader(f)
                    for row in reader:
                        self._process_row(row, events)
                        if max_events and len(events) >= max_events: return events
                else:
                    for line in f:
                        line = line.strip()
                        if not line: continue
                        try:
                            obj = json.loads(line)
                            self._process_row(obj, events)
                            if max_events and len(events) >= max_events: return events
                        except json.JSONDecodeError:
                            continue
        return events

    def _fetch_from_s3(self, max_events: Optional[int] = None) -> List[TelemetryEvent]:
        s3_uri = self.source[5:]
        bucket, _, key = s3_uri.partition("/")
        if not bucket:
            raise ValueError(f"Invalid S3 URI: {self.source}")

        s3 = boto3.client("s3", region_name=self.aws_region)
        events: List[TelemetryEvent] = []

        if key and not key.endswith("/"):
            keys = [key]
        else:
            prefix = key
            keys = []
            paginator = s3.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
                for item in page.get("Contents", []):
                    k = item["Key"]
                    if k.lower().endswith((".jsonl", ".ndjson", ".txt", ".log", ".csv")):
                        keys.append(k)

        if not keys:
            raise FileNotFoundError(f"No eligible objects found in {self.source}")

        for k in keys:
            obj = s3.get_object(Bucket=bucket, Key=k)
            body = obj["Body"].read().decode("utf-8", errors="ignore")
            is_csv = k.lower().endswith('.csv')
            
            if is_csv:
                reader = csv.DictReader(io.StringIO(body))
                for row in reader:
                    self._process_row(row, events)
                    if max_events and len(events) >= max_events: return events
            else:
                for line in body.splitlines():
                    line = line.strip()
                    if not line: continue
                    try:
                        row = json.loads(line)
                        self._process_row(row, events)
                        if max_events and len(events) >= max_events: return events
                    except json.JSONDecodeError:
                        continue

        return events

# -----------------------------
# 2) Aggregation (Session Level)
# -----------------------------

class SessionAggregator:
    """
    ingest() + groupBySession() => List[SessionData]
    """

    def __init__(self):
        self._by_session: Dict[str, List[TelemetryEvent]] = {}

    def ingest(self, event: TelemetryEvent) -> None:
        self._by_session.setdefault(event.sessionId, []).append(event)

    def ingest_many(self, events: Iterable[TelemetryEvent]) -> None:
        for e in events:
            self.ingest(e)

    def groupBySession(self) -> List[SessionData]:
        sessions: List[SessionData] = []
        for sid, evs in self._by_session.items():
            if not evs:
                continue
            evs_sorted = sorted(evs, key=lambda x: x.timestamp)
            start = evs_sorted[0].timestamp
            end = evs_sorted[-1].timestamp
            sessions.append(SessionData(sessionId=sid, events=evs_sorted, startTime=start, endTime=end))
        sessions.sort(key=lambda s: s.startTime)
        return sessions


# -----------------------------
# 3) Feature Engineering
# -----------------------------

class FeatureExtractor:
    """
    Creates fixed-length numeric vectors per session.
    Includes normalize() and encodeCategorical() (even if you later expand categoricals).
    """

    FEATURE_NAMES = [
        "event_count",
        "page_view_count",
        "unique_route_count",
        "click_count",
        "field_change_count",
        "flow_success_count",
        "flow_failure_count",
        "error_event_count",
        "retry_count",
        "rage_click_count",
        "session_duration_ms",
        "total_dwell_ms",
        "avg_inter_event_gap_ms",
    ]

    def __init__(self, do_normalize: bool = True, normalize_method: str = "zscore",
                 schema: Optional[Dict[str, Any]] = None):
        self.do_normalize = do_normalize
        self.normalize_method = normalize_method
        self._norm_stats: Optional[Dict[str, Dict[str, float]]] = None

        et = (schema or load_schema()).get("event_types", {})
        self._page_view_types     = frozenset(et.get("page_view",     ["page_view"]))
        self._click_types         = frozenset(et.get("click",         ["cta_click", "nav_click", "statements_click"]))
        self._field_change_types  = frozenset(et.get("field_change",  ["field_change"]))
        self._flow_complete_types = frozenset(et.get("flow_complete", ["flow_complete"]))
        self._error_types         = frozenset(et.get("error",         ["trade_step_error"]))
        self._retry_types         = frozenset(et.get("retry",         ["retry_attempt"]))
        self._rage_click_types    = frozenset(et.get("rage_click",    ["rage_click"]))
        self._page_view_end_types = frozenset(et.get("page_view_end", ["page_view_end"]))

    def encodeCategorical(self, value: Optional[str], mapping: Dict[str, int]) -> int:
        if value is None:
            value = "__NULL__"
        if value not in mapping:
            mapping[value] = len(mapping)
        return mapping[value]

    def createFeatureVector(self, session: SessionData) -> FeatureVector:
        evs = session.events
        event_count = float(len(evs))

        page_view_count = float(sum(1 for e in evs if e.eventType in self._page_view_types))
        routes = [e.pageRoute for e in evs if e.pageRoute]
        unique_route_count = float(len(set(routes)))

        click_count = float(sum(1 for e in evs if e.eventType in self._click_types))
        field_change_count = float(sum(1 for e in evs if e.eventType in self._field_change_types))

        flow_success_count = 0.0
        flow_failure_count = 0.0
        for e in evs:
            if e.eventType in self._flow_complete_types and e.metadata:
                status = e.metadata.get("status")
                if status == "success":
                    flow_success_count += 1.0
                elif status == "failure":
                    flow_failure_count += 1.0

        explicit_error_count = float(sum(1 for e in evs if e.eventType in self._error_types))
        error_event_count = explicit_error_count + flow_failure_count

        retry_count = float(sum(1 for e in evs if e.eventType in self._retry_types))
        rage_click_count = float(sum(1 for e in evs if e.eventType in self._rage_click_types))

        session_duration_ms = float(session.duration_ms)

        total_dwell_ms = 0.0
        for e in evs:
            if e.eventType in self._page_view_end_types and e.metadata:
                dm = e.metadata.get("dwellMs")
                if isinstance(dm, (int, float)) and dm >= 0:
                    total_dwell_ms += float(dm)

        if len(evs) <= 1:
            avg_gap = 0.0
        else:
            gaps = []
            for i in range(1, len(evs)):
                dt = (evs[i].timestamp - evs[i - 1].timestamp).total_seconds() * 1000.0
                if dt >= 0:
                    gaps.append(dt)
            avg_gap = float(np.mean(gaps)) if gaps else 0.0

        vector = [
            event_count,
            page_view_count,
            unique_route_count,
            click_count,
            field_change_count,
            flow_success_count,
            flow_failure_count,
            error_event_count,
            retry_count,
            rage_click_count,
            session_duration_ms,
            total_dwell_ms,
            avg_gap,
        ]

        fv = FeatureVector(vector=[float(x) for x in vector], featureNames=list(self.FEATURE_NAMES), isValid=True)
        fv.validate()
        return fv

    def fit_normalize(self, X: np.ndarray, feature_names: List[str]) -> Dict[str, Dict[str, float]]:
        stats: Dict[str, Dict[str, float]] = {}
        for j, name in enumerate(feature_names):
            col = X[:, j].astype(float)
            col_min = float(np.min(col))
            col_max = float(np.max(col))
            col_mean = float(np.mean(col))
            col_std = float(np.std(col)) if float(np.std(col)) > 0 else 1.0
            stats[name] = {"min": col_min, "max": col_max, "mean": col_mean, "std": col_std}
        self._norm_stats = stats
        return stats

    def normalize(self, X: np.ndarray, feature_names: List[str]) -> np.ndarray:
        if not self.do_normalize:
            return X

        if self._norm_stats is None:
            self.fit_normalize(X, feature_names)

        assert self._norm_stats is not None
        Xn = X.astype(np.float32).copy()

        for j, name in enumerate(feature_names):
            s = self._norm_stats[name]
            if self.normalize_method == "minmax":
                denom = (s["max"] - s["min"]) if (s["max"] - s["min"]) != 0 else 1.0
                Xn[:, j] = (Xn[:, j] - s["min"]) / denom
            else:  # zscore
                Xn[:, j] = (Xn[:, j] - s["mean"]) / (s["std"] if s["std"] != 0 else 1.0)

        Xn = np.nan_to_num(Xn, nan=0.0, posinf=0.0, neginf=0.0)
        return Xn

    @property
    def norm_stats(self) -> Optional[Dict[str, Dict[str, float]]]:
        return self._norm_stats


# -----------------------------
# Orchestration / Main
# -----------------------------
def format_ts(dt: datetime) -> str:
    """Format timestamp as UTC ISO-8601 to seconds, with 'Z' suffix."""
    dt = dt.astimezone(timezone.utc)
    dt = dt.replace(microsecond=0)
    return dt.isoformat().replace("+00:00", "Z")


def build_feature_matrix(
    sessions: List[SessionData],
    extractor: FeatureExtractor
) -> Tuple[np.ndarray, List[str], List[str], List[str], List[Optional[str]]]:
    """
    Returns:
      X: (n_sessions, n_features)
      feature_names
      session_ids (aligned with rows)
      session_timestamps (aligned with rows)  <-- session startTime ISO
      user_ids (aligned with rows)  <-- first non-None userId from session events, or None
    """
    feature_names = list(extractor.FEATURE_NAMES)
    vectors: List[List[float]] = []
    session_ids: List[str] = []
    session_timestamps: List[str] = []
    user_ids: List[Optional[str]] = []

    for s in sessions:
        fv = extractor.createFeatureVector(s)
        if fv.featureNames != feature_names:
            raise ValueError("Feature schema mismatch. Ensure FeatureExtractor.FEATURE_NAMES is stable.")
        vectors.append(fv.vector)
        session_ids.append(s.sessionId)
        session_timestamps.append(format_ts(s.startTime))
        user_ids.append(next((e.userId for e in s.events if e.userId is not None), None))

    X = np.array(vectors, dtype=np.float32) if vectors else np.zeros((0, len(feature_names)), dtype=np.float32)
    X = extractor.normalize(X, feature_names)
    return X, feature_names, session_ids, session_timestamps, user_ids


def save_outputs(
    X: np.ndarray,
    feature_names: List[str],
    session_ids: List[str],
    session_timestamps: List[str],
    user_ids: List[Optional[str]],
    out_dir: str,
    out_format: str = "csv",
    include_session_id: bool = False,
    include_timestamp: bool = False,
    include_user_id: bool = False,
    extractor: Optional[FeatureExtractor] = None,
) -> None:
    os.makedirs(out_dir, exist_ok=True)

    with open(os.path.join(out_dir, "feature_names.json"), "w", encoding="utf-8") as f:
        json.dump(feature_names, f, indent=2)

    if extractor is not None and extractor.norm_stats is not None:
        with open(os.path.join(out_dir, "normalization_stats.json"), "w", encoding="utf-8") as f:
            json.dump(extractor.norm_stats, f, indent=2)

    if out_format == "npy":
        np.save(os.path.join(out_dir, "feature_vector.npy"), X)
        if include_session_id:
            with open(os.path.join(out_dir, "session_ids.json"), "w", encoding="utf-8") as f:
                json.dump(session_ids, f, indent=2)
        if include_timestamp:
            with open(os.path.join(out_dir, "timestamps.json"), "w", encoding="utf-8") as f:
                json.dump(session_timestamps, f, indent=2)
        return

    df = pd.DataFrame(X, columns=feature_names)

    insert_at = 0
    if include_session_id:
        df.insert(insert_at, "sessionId", session_ids)
        insert_at += 1
    if include_timestamp:
        df.insert(insert_at, "timestamp", session_timestamps)
        insert_at += 1
    if include_user_id:
        df.insert(insert_at, "userId", user_ids)

    df.to_csv(os.path.join(out_dir, "feature_vector.csv"), index=False)


def save_to_rds(df: pd.DataFrame) -> None:
    """
    Appends the feature DataFrame to the configured PostgreSQL RDS table.

    Connection parameters are read from environment variables:
      RDS_HOST, RDS_PORT, RDS_DB, RDS_USER, RDS_PASSWORD, RDS_TABLE

    The table is created automatically on first insert (if_exists='append').
    """
    if not RDS_HOST or not RDS_USER or not RDS_PASSWORD:
        raise RuntimeError(
            "RDS connection not configured. Set RDS_HOST, RDS_USER, and RDS_PASSWORD "
            "environment variables, or run with --local-only for local-only output."
        )

    try:
        from sqlalchemy import create_engine
    except ImportError:
        raise RuntimeError("sqlalchemy is required for RDS saving. Run: pip install sqlalchemy psycopg2-binary")

    url = f"postgresql+psycopg2://{RDS_USER}:{RDS_PASSWORD}@{RDS_HOST}:{RDS_PORT}/{RDS_DB}"
    engine = create_engine(url)
    df["ingested_at"] = pd.Timestamp.utcnow()
    df.to_sql(RDS_TABLE, con=engine, if_exists="append", index=False)
    print(f"[OK] {len(df)} rows written to RDS table '{RDS_TABLE}' on {RDS_HOST}/{RDS_DB}")


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument("--input", type=str, default=os.environ.get("SM_CHANNEL_INPUT", "/opt/ml/processing/input"))
    parser.add_argument("--output", type=str, default=os.environ.get("SM_OUTPUT_DATA_DIR", "/opt/ml/processing/output"))

    parser.add_argument("--aws-region", type=str, default=os.environ.get("AWS_REGION"))
    parser.add_argument("--max-events", type=int, default=None)

    parser.add_argument("--no-normalize", action="store_true", help="Disable dataset-level normalization")
    parser.add_argument("--normalize-method", type=str, default="zscore", choices=["zscore", "minmax"])

    parser.add_argument("--format", type=str, default="csv", choices=["csv", "npy"])
    parser.add_argument("--include-session-id", action="store_true")
    parser.add_argument("--include-timestamp", action="store_true", help="Include session start timestamp in outputs")
    parser.add_argument("--include-user-id", action="store_true", help="Include userId in outputs")
    parser.add_argument("--schema", type=str, default=None,
                        help="Path to platform schema JSON (default: config/schema_default.json)")
    parser.add_argument("--local-only", action="store_true",
                        help="Write output files locally only; skip RDS (useful for testing)")

    args = parser.parse_args()

    schema = load_schema(args.schema)
    loader = S3DataLoader(source=args.input, aws_region=args.aws_region, schema=schema)
    raw_events = loader.fetchRawLogs(max_events=args.max_events)
    if not raw_events:
        raise RuntimeError(f"No telemetry events loaded from input: {args.input}")

    aggregator = SessionAggregator()
    aggregator.ingest_many(raw_events)
    sessions = aggregator.groupBySession()
    if not sessions:
        raise RuntimeError("No sessions were formed. Check sessionId field in telemetry logs.")

    extractor = FeatureExtractor(
        do_normalize=(not args.no_normalize),
        normalize_method=args.normalize_method,
        schema=schema
    )

    X, feature_names, session_ids, session_timestamps, user_ids = build_feature_matrix(sessions, extractor)

    if X.shape[1] != len(feature_names):
        raise ValueError(f"Output schema invalid: X.shape={X.shape}, feature_names={len(feature_names)}")

    save_outputs(
        X=X,
        feature_names=feature_names,
        session_ids=session_ids,
        session_timestamps=session_timestamps,
        user_ids=user_ids,
        out_dir=args.output,
        out_format=args.format,
        include_session_id=args.include_session_id,
        include_timestamp=args.include_timestamp,
        include_user_id=args.include_user_id,
        extractor=extractor
    )

    print(f"[OK] Loaded events: {len(raw_events)}")
    print(f"[OK] Sessions: {len(session_ids)}")
    print(f"[OK] Feature matrix: {X.shape}")
    print(f"[OK] Output written to: {args.output}")

    if not args.local_only:
        df_rds = pd.DataFrame(X, columns=feature_names)
        if args.include_session_id:
            df_rds.insert(0, "sessionId", session_ids)
        if args.include_timestamp:
            df_rds.insert(1 if args.include_session_id else 0, "timestamp", session_timestamps)
        if args.include_user_id:
            df_rds.insert(
                sum([args.include_session_id, args.include_timestamp]),
                "userId",
                user_ids,
            )
        save_to_rds(df_rds)
    else:
        print("[INFO] --local-only: skipping RDS write.")


if __name__ == "__main__":
    main()
