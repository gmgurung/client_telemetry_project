import { Outlet, NavLink } from "react-router-dom";

const linkStyle = ({ isActive }) => ({
  marginRight: 12,
  textDecoration: "none",
  fontWeight: isActive ? 700 : 400,
});

export default function Layout() {
  return (
    <div style={{ padding: 16, fontFamily: "system-ui, Arial" }}>
      <h2 style={{ marginTop: 0 }}>Client Telemetry Dashboard (Prototype)</h2>

      <nav style={{ marginBottom: 16 }}>
        <NavLink to="/sessions" style={linkStyle}>Sessions</NavLink>
        <NavLink to="/alerts" style={linkStyle}>Alerts</NavLink>
        <NavLink to="/queue" style={linkStyle}>Queue</NavLink>
        <NavLink to="/admin" style={linkStyle}>Admin</NavLink>
      </nav>

      <Outlet />
    </div>
  );
}

