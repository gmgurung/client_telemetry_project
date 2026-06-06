import { useState } from "react";

export default function OverrideForm({ session, onSave, onClear }) {
  const [severity, setSeverity] = useState(session?.severity || "LOW");
  const [comment, setComment] = useState(session?.override?.comment || "");
  const [saving, setSaving] = useState(false);

  if (!session) return null;

  const hasOverride = Boolean(session.override?.updatedAt);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        sessionId: session.sessionId,
        severity,
        comment,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 10, maxWidth: 520 }}>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Selected Session</div>
        <div>
          <b>{session.sessionId}</b>
        </div>
        <div style={{ color: "#666", fontSize: 14 }}>
          Model severity: <b>{session.override ? "(overridden)" : ""}</b>
        </div>
      </div>

      <label style={{ display: "grid", gap: 6 }}>
        Override severity
        <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="LOW">LOW</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="HIGH">HIGH</option>
        </select>
      </label>

      <label style={{ display: "grid", gap: 6 }}>
        Comment (optional)
        <textarea
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Why are you overriding? (e.g., false positive; user recovered; test scenario mismatch)"
        />
      </label>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save override"}
        </button>

        <button
          type="button"
          disabled={!hasOverride || saving}
          onClick={() => onClear(session.sessionId)}
        >
          Clear override
        </button>

        {hasOverride && (
          <span style={{ color: "#666", fontSize: 13 }}>
            Last updated: {new Date(session.override.updatedAt).toLocaleString()}
          </span>
        )}
      </div>
    </form>
  );
}
