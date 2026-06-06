import { useNavigate } from "react-router-dom";
import SeverityBadge from "./SeverityBadge";

export default function AlertsTable({ rows }) {
  const navigate = useNavigate();

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
          <th style={{ padding: 10 }}>Session ID</th>
          <th style={{ padding: 10 }}>Scenario</th>
          <th style={{ padding: 10 }}>Score</th>
          <th style={{ padding: 10 }}>Severity</th>
          <th style={{ padding: 10 }}>Status</th>
          <th style={{ padding: 10 }}>Events</th>
          <th style={{ padding: 10 }}>Timestamp</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr
            key={s.sessionId}
            onClick={() => navigate(`/sessions/${s.sessionId}`)}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#fafafa")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            style={{
              cursor: "pointer",
              borderBottom: "1px solid #f0f0f0",
            }}
          >
            <td style={{ padding: 10, fontWeight: 600 }}>{s.sessionId}</td>
            <td style={{ padding: 10 }}>{s.scenario || "—"}</td>
            <td style={{ padding: 10 }}>{s.frustrationScore ?? "—"}</td>
            <td style={{ padding: 10 }}>
              <SeverityBadge severity={s.severity} />
            </td>
            <td style={{ padding: 10 }}>{s.status || "—"}</td>
            <td style={{ padding: 10 }}>{s.eventCount ?? s.events ?? "—"}</td>
            <td style={{ padding: 10 }}>
              {s.timestamp ? new Date(s.timestamp).toLocaleString() : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
