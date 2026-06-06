// src/api/dashboardApi.js

// ---------------------------
// Backend API base
// ---------------------------
const API_BASE =
  import.meta.env.VITE_DASHBOARD_API_BASE ||
  "http://127.0.0.1:4000";

// ---------------------------
// Demo events (still used for event timeline only)
// ---------------------------
import events5230 from "../mock/events_S1770848729214-5230.json";

// ---------------------------
// Overrides (localStorage)
// ---------------------------
const OVERRIDES_KEY = "dashboard.overrides.v1";

/*
overrides shape:
{
  [sessionId]: {
    severity: "LOW"|"MEDIUM"|"HIGH",
    comment: string,
    updatedAt: string
  }
}
*/

function readOverrides() {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeOverrides(obj) {
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(obj));
}

function applyOverridesToSessions(sessions) {
  const overrides = readOverrides();

  return sessions.map((s) => {
    const o = overrides[s.sessionId];
    if (!o) return s;

    return {
      ...s,
      severity: o.severity,
      override: {
        severity: o.severity,
        comment: o.comment || "",
        updatedAt: o.updatedAt,
      },
    };
  });
}

// ---------------------------
// Fetch helper
// ---------------------------
async function fetchJson(url) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Request failed (${res.status})`);
  }

  return res.json();
}

// ---------------------------
// Sessions
// ---------------------------
async function fetchSessionsFromBackend() {
  return fetchJson(`${API_BASE}/api/sessions`);
}

export async function getSessions() {
  const sessions = await fetchSessionsFromBackend();
  return applyOverridesToSessions(sessions);
}

export async function getSessionById(sessionId) {
  const session = await fetchJson(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}`
  );

  const overrides = readOverrides();
  const o = overrides[session.sessionId];

  if (!o) return session;

  return {
    ...session,
    severity: o.severity,
    override: {
      severity: o.severity,
      comment: o.comment || "",
      updatedAt: o.updatedAt,
    },
  };
}

// ---------------------------
// Alerts
// ---------------------------
export async function getAlerts() {
  const sessions = await getSessions();
  return sessions.filter(
    (s) => s.severity === "MEDIUM" || s.severity === "HIGH"
  );
}

// ---------------------------
// Queue
// Uses backend ordering:
// ONGOING first -> severity -> timestamp
// ---------------------------
export async function getQueue() {
  const queue = await fetchJson(`${API_BASE}/api/queue`);
  return applyOverridesToSessions(queue);
}

// ---------------------------
// Session Detail Metrics
// (coming from backend)
// ---------------------------
export async function getSessionAggregates(sessionId) {
  return fetchJson(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/metrics`
  );
}

// ---------------------------
// Event timeline
// (still demo data)
// ---------------------------
export async function getSessionEvents(sessionId) {
  const res = await fetch(
    `http://127.0.0.1:4000/api/sessions/${sessionId}/events`
  );

  if (!res.ok) {
    throw new Error("Failed to fetch session events");
  }

  return await res.json();
}

// ---------------------------
// Admin Overrides
// ---------------------------
export async function getOverrides() {
  return readOverrides();
}

export async function saveOverride({ sessionId, severity, comment }) {
  const overrides = readOverrides();

  overrides[sessionId] = {
    severity,
    comment: comment || "",
    updatedAt: new Date().toISOString(),
  };

  writeOverrides(overrides);

  return getSessionById(sessionId);
}

export async function clearOverride(sessionId) {
  const overrides = readOverrides();
  delete overrides[sessionId];
  writeOverrides(overrides);
  return true;
}
