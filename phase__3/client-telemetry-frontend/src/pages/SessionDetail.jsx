import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import SeverityBadge from "../components/SeverityBadge";
import MetricsGrid from "../components/MetricsGrid";
import EventsTable from "../components/EventsTable";
import { getSessionById, getSessionEvents, getSessionAggregates } from "../api/dashboardApi";

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function metricValue(value, suffix = "") {
  if (value === null || value === undefined) return "—";
  return `${value}${suffix}`;
}

export default function SessionDetail() {
  const { sessionId } = useParams();

  const [session, setSession] = useState(null);
  const [events, setEvents] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);

      try {
        const s = await getSessionById(sessionId);

        let evts = [];
        let agg = null;

        try {
          evts = await getSessionEvents(sessionId);
        } catch {
          evts = [];
        }

        try {
          agg = await getSessionAggregates(sessionId);
        } catch {
          agg = null;
        }

        if (!alive) return;
        setSession(s);
        setEvents(evts);
        setMetrics(agg);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [sessionId]);

  if (loading) {
    return (
      <div>
        <h2>Session Detail</h2>
        <p>Loading…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <h2>Session Detail</h2>
        <p>Session not found: <b>{sessionId}</b></p>
        <Link to="/sessions">← Back to Sessions</Link>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Link to="/sessions">← Back to Sessions</Link>
      </div>

      <h2>Session Detail</h2>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 18 }}>
          Session: <b>{session.sessionId}</b>
        </div>
        <SeverityBadge severity={session.severity} />
        <div>
          Score: <b style={{ fontSize: 18 }}>{session.frustrationScore}</b>
        </div>
      </div>

      {/* Metadata */}
      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Metadata</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          <div><div style={{ opacity: 0.7 }}>Scenario</div><b>{session.scenario || "—"}</b></div>
          <div><div style={{ opacity: 0.7 }}>Status</div><b>{session.status || "—"}</b></div>
          <div><div style={{ opacity: 0.7 }}>Timestamp</div><b>{formatDate(session.timestamp)}</b></div>
          <div>
            <div style={{ opacity: 0.7 }}>Events</div>
            <b style={{ fontSize: 18, color: "#1a73e8" }}>
              {metricValue(session.events ?? metrics?.eventCount)}
            </b>
          </div>
        </div>
      </div>

      {/* Existing metrics */}
      <MetricsGrid metrics={metrics} />

      {/* Additional behavior metrics */}
      {metrics && (
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Behavior Metrics</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
            <div><div style={{ opacity: 0.7 }}>Page Views</div><b>{metricValue(metrics.pageViewCount)}</b></div>
            <div><div style={{ opacity: 0.7 }}>Unique Routes</div><b>{metricValue(metrics.uniqueRouteCount)}</b></div>
            <div><div style={{ opacity: 0.7 }}>Field Changes</div><b>{metricValue(metrics.fieldChangeCount)}</b></div>
            <div><div style={{ opacity: 0.7 }}>Session Duration</div><b style={{ fontSize: 18, color: "#1a73e8" }}>
              {metricValue(metrics.sessionDurationSec, " s")}
            </b></div>

            <div><div style={{ opacity: 0.7 }}>Event Count</div><b>{metricValue(metrics.eventCount)}</b></div>
            <div><div style={{ opacity: 0.7 }}>Rage Click Count</div><b>{metricValue(metrics.rageClickCount)}</b></div>
            <div><div style={{ opacity: 0.7 }}>Flow Success Count</div><b>{metricValue(metrics.flowSuccessCount)}</b></div>
            <div><div style={{ opacity: 0.7 }}>Flow Failure Count</div><b>{metricValue(metrics.flowFailureCount)}</b></div>
          </div>
        </div>
      )}

      {/* Session outcome */}
      {metrics && (
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Session Outcome</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
            <div><div style={{ opacity: 0.7 }}>Outcome</div><span style={{
              padding: "4px 10px",
              borderRadius: 12,
              fontWeight: "bold",
              backgroundColor:
                metrics.sessionOutcome === "SUCCESS" ? "#e6f4ea" :
                metrics.sessionOutcome === "FAILURE" ? "#fdecea" :
                "#f1f3f4",
              color:
                metrics.sessionOutcome === "SUCCESS" ? "#188038" :
                metrics.sessionOutcome === "FAILURE" ? "#d93025" :
                "#5f6368"
            }}>
              {metrics.sessionOutcome || "Outcome not available"}
            </span></div>
            <div><div style={{ opacity: 0.7 }}>Avg Time Between Events</div><b>{metricValue(metrics.avgInterEventGapMs, " ms")}</b></div>
            <div><div style={{ opacity: 0.7 }}>Run ID</div><b style={{ fontSize: 12 }}>{metricValue(metrics.runSuffix)}</b></div>
          </div>
        </div>
      )}

      {/* Timeline */}
      <EventsTable events={events} />
    </div>
  );
}
