// src/api/client.js
const BASE = import.meta.env.VITE_DASHBOARD_API_BASE || "";

export async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}
