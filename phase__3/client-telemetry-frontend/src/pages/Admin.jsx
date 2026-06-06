import { useEffect, useMemo, useState } from "react";
import OverrideForm from "../components/OverrideForm";
import SeverityBadge from "../components/SeverityBadge";
import { clearOverride, getSessions, saveOverride } from "../api/dashboardApi";

export default function Admin() {
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  async function refresh() {
    setLoading(true);
    setErr("");
    try {
      const data = await getSessions();
      setSessions(Array.isArray(data) ? data : []);
      if (!selectedId && data?.length) setSelectedId(data[0].sessionId);
    } catch (e) {
      setErr(e?.message || "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(() => {
    return sessions.find((s) => s.sessionId === selectedId) || null;
  }, [sessions, selectedId]);

  async function handleSave(payload) {
    try {
      await saveOverride(payload);
      setToast("Override saved. (Check Sessions / Alerts / Queue to see it update.)");
      await refresh();
    } catch (e) {
      setToast(e?.message || "Failed to save override.");
    } finally {
      setTimeout(() => setToast(""), 2500);
    }
  }

  async function handleClear(sessionId) {
    try {
      await clearOverride(sessionId);
      setToast("Override cleared.");
      await refresh();
    } catch (e) {
      setToast(e?.message || "Failed to clear override.");
    } finally {
      setTimeout(() => setToast(""), 2500);
    }
  }

  if (loading) return <div>Loading admin…</div>;
  if (err) return <div style={{ color: "crimson" }}>{err}</div>;

  if (sessions.length === 0) {
    return (
      <div>
        <h2>Admin Override & Feedback</h2>
        <p>Override severity + add a comment. This is stored as feedback (demo).</p>
        <div style={{ opacity: 0.7 }}>
          No sessions available.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2>Admin Override & Feedback</h2>
      <p>Override severity + add a comment. This is stored as feedback (demo).</p>

      {toast && (
        <div style={{ margin: "10px 0", padding: 10, border: "1px solid #ddd", borderRadius: 8 }}>
          {toast}
        </div>
      )}

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "360px 1fr", alignItems: "start" }}>
        {/* Left: session picker */}
        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Pick a session</div>

          <select
            style={{ width: "100%", padding: 8 }}
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {sessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.sessionId} — {s.severity}
              </option>
            ))}
          </select>

          {selected && (
            <div style={{ marginTop: 12, fontSize: 14, color: "#333" }}>
              <div style={{ marginBottom: 6 }}>
                Severity: <SeverityBadge severity={selected.severity} />
              </div>
              <div>Score: <b>{typeof selected.frustrationScore === "number" ? selected.frustrationScore : "—"}</b></div>
              <div>Scenario: <b>{selected.scenario || "—"}</b></div>
              <div>Timestamp: <b>{selected.timestamp ? new Date(selected.timestamp).toLocaleString() : "—"}</b></div>
              {selected.override?.comment && (
                <div style={{ marginTop: 8, color: "#666" }}>
                  Override comment: “{selected.override.comment}”
                </div>
              )}
            </div>
          )}

          <button style={{ marginTop: 12 }} onClick={refresh}>
            Refresh
          </button>
        </div>

        {/* Right: override form */}
        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
          <OverrideForm session={selected} onSave={handleSave} onClear={handleClear} />
        </div>
      </div>
    </div>
  );
}
