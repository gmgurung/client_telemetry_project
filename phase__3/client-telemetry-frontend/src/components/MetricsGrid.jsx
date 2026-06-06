import React from "react";

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  return value;
}

export default function MetricsGrid({ metrics }) {
  if (!metrics) return null;

  const entries = [
    ["Total Clicks", metrics.totalClicks],
    ["Error Count", metrics.errorCount],
    ["Retry Count", metrics.retryCount],
    ["Rage Click Count", metrics.rageClickCount],
    ["Idle Timeout Count", metrics.idleTimeoutCount],
    ["Avg Dwell Time (s)", Number(metrics.avgDwellTime || 0).toFixed(2)],
    ["Navigation Loop Count", metrics.navLoopCount],
    ["Backtrack Rate", metrics.backtrackRate],
    ["Form Abandonment", String(metrics.formAbandonment)],
    ["Raw Event Count", metrics.eventCount],
  ];

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Aggregated Metrics</h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12 }}>
        {entries.map(([label, value]) => (
          <div
            key={label}
            style={{
              background: "#fafafa",
              border: "1px solid #eee",
              borderRadius: 8,
              padding: 10,
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
            <div style={{ fontWeight: 700 }}>{displayValue(value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
