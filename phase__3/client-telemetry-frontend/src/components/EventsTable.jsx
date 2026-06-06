import React, { useMemo, useState } from "react";

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function metaSummary(metadata) {
  if (!metadata || Object.keys(metadata).length === 0) return "—";
  const entries = Object.entries(metadata).slice(0, 3);
  const short = entries.map(([k, v]) => `${k}=${String(v)}`).join(", ");
  return Object.keys(metadata).length > 3 ? `${short} …` : short;
}

export default function EventsTable({ events }) {
  const [showJson, setShowJson] = useState(false);

  const sorted = useMemo(() => {
    return [...(events || [])].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [events]);

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h3 style={{ marginTop: 0 }}>Event Timeline</h3>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={showJson} onChange={(e) => setShowJson(e.target.checked)} />
          Show metadata JSON
        </label>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table width="100%" cellPadding="8" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
              <th>Time</th>
              <th>Event</th>
              <th>Route</th>
              <th>User</th>
              <th>Metadata</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 12, opacity: 0.7 }}>
                  No event timeline data available for this session.
                </td>
              </tr>
            ) : (
              sorted.map((e, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid #f3f3f3", verticalAlign: "top" }}>
                  <td>{formatDate(e.timestamp)}</td>
                  <td>
                    <code>{e.eventType || "—"}</code>
                  </td>
                  <td>{e.pageRoute || "—"}</td>
                  <td>{e.userId || "—"}</td>
                  <td>
                    {showJson ? (
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(e.metadata ?? {}, null, 2)}
                      </pre>
                    ) : (
                      <span>{metaSummary(e.metadata)}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
