import { useEffect, useState } from "react";
import QueueTable from "../components/QueueTable";
import { getQueue } from "../api/dashboardApi";

export default function Queue() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setErr("");
        const data = await getQueue();
        if (!mounted) return;
        setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!mounted) return;
        setErr(e?.message || "Failed to load queue");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return <div>Loading queue…</div>;
  if (err) return <div style={{ color: "crimson" }}>{err}</div>;

  if (rows.length === 0) {
    return (
      <div>
        <h2>Queue & Agent Selection</h2>
        <p>
          <b>ONGOING</b> sessions are prioritized first, followed by <b>severity</b> level and <b>timestamp</b>.
        </p>
        <div style={{ opacity: 0.7 }}>
          No sessions available for prioritization.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2>Queue & Agent Selection</h2>
      <p><b>ONGOING</b> sessions are prioritized first, followed by <b>severity</b> level and <b>timestamp</b>.</p>

      <QueueTable rows={rows} />
    </div>
  );
}
