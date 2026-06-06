import { useNavigate } from "react-router-dom";
import SeverityBadge from "./SeverityBadge";

export default function QueueTable({ rows = [] }) {
  const navigate = useNavigate();

  if (!rows.length) {
    return (
      <div style={{ opacity: 0.7 }}>
        No sessions currently in queue.
      </div>
    );
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ textAlign: "left" }}>
          <th style={{ padding: "10px 8px", borderBottom: "1px solid #ddd" }}>Pos</th>
          <th style={{ padding: "10px 8px", borderBottom: "1px solid #ddd" }}>Session ID</th>
          <th style={{ padding: "10px 8px", borderBottom: "1px solid #ddd" }}>Scenario</th>
          <th style={{ padding: "10px 8px", borderBottom: "1px solid #ddd" }}>Score</th>
          <th style={{ padding: "10px 8px", borderBottom: "1px solid #ddd" }}>Severity</th>
          <th style={{ padding: "10px 8px", borderBottom: "1px solid #ddd" }}>Status</th>
          <th style={{ padding: "10px 8px", borderBottom: "1px solid #ddd" }}>Timestamp</th>
          <th style={{ padding: "10px 8px", borderBottom: "1px solid #ddd" }}>Action</th>
        </tr>
      </thead>

      <tbody>
        {rows.map((r) => (
          <tr
            key={r.sessionId}
            onClick={() => navigate(`/sessions/${r.sessionId}`)}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#fafafa")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            style={{ cursor: "pointer" }}
          >
            <td style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>
              {r.queuePosition ?? "—"}
            </td>

            <td style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>
              <b>{r.sessionId}</b>
            </td>

            <td style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>
              {r.scenario || "—"}
            </td>

            <td style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>
              {typeof r.score === "number"
                ? r.score
                : r.frustrationScore ?? "—"}
            </td>

            <td style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>
              <SeverityBadge severity={r.severity} />
            </td>

            <td style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>
              <b>{r.status || "—"}</b>
            </td>

            <td style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>
              {r.timestamp ? new Date(r.timestamp).toLocaleString() : "—"}
            </td>

            <td
              style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}
              onClick={(e) => e.stopPropagation()}
            >
              <button onClick={() => alert(`Selected session ${r.sessionId} (demo only)`)}>
                Select
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
