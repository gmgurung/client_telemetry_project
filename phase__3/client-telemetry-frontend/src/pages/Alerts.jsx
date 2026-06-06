import { useEffect, useState } from "react";
import AlertsTable from "../components/AlertsTable";
import { getAlerts } from "../api/dashboardApi";

export default function Alerts() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoading(true);
        setErr("");
        const data = await getAlerts();
        if (!mounted) return;
        setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!mounted) return;
        setErr(e?.message || "Failed to load alerts");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return <div>Loading alerts…</div>;
  if (err) return <div style={{ color: "crimson" }}>{err}</div>;

  if (rows.length === 0) {
    return (
      <div>
        <h2>Alert Monitoring</h2>
        <p>
          Sessions filtered to <b>MEDIUM</b> / <b>HIGH</b> severity.
        </p>
        <div style={{ opacity: 0.7 }}>
          No medium or high severity sessions available.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2>Alert Monitoring</h2>
      <p>
        Sessions filtered to <b>MEDIUM</b> / <b>HIGH</b> severity.
      </p>

      <AlertsTable rows={rows} />
    </div>
  );
}
