import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Sessions from "./pages/Sessions";
import SessionDetail from "./pages/SessionDetail";
import Alerts from "./pages/Alerts";
import Queue from "./pages/Queue";
import Admin from "./pages/Admin";

export default function App() {
  return (
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/sessions" replace />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/sessions/:sessionId" element={<SessionDetail />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/admin" element={<Admin />} />
        </Route>
      </Routes>
  );
}
