import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import MainLayout from '../layouts/MainLayout';
import ProtectedRoute from './ProtectedRoute';
import Landing from '../pages/Landing';
import Login from '../pages/Login';
import ForgotPassword from '../pages/ForgotPassword';
import ResetPassword from '../pages/ResetPassword';
import NotFound from '../pages/NotFound';

// Lazy-loaded pages — each module is code-split so the initial bundle only
// ships the login screen + shell; module code loads on first navigation to it.
const Dashboard = lazy(() => import('../pages/Dashboard'));
const IncidentFeed = lazy(() => import('../pages/IncidentFeed'));
const Mapping = lazy(() => import('../pages/Mapping'));
const Analytics = lazy(() => import('../pages/Analytics'));
const Trends = lazy(() => import('../pages/Trends'));
const Records = lazy(() => import('../pages/Records'));
const CriminalRecords = lazy(() => import('../pages/CriminalRecords'));
const VictimRecords = lazy(() => import('../pages/VictimRecords'));
const CriminalProfile = lazy(() => import('../pages/CriminalProfile'));
const VictimProfile = lazy(() => import('../pages/VictimProfile'));
const AuditLogs = lazy(() => import('../pages/AuditLogs'));
const UserManagement = lazy(() => import('../pages/UserManagement'));
const Settings = lazy(() => import('../pages/Settings'));

function PageFallback() {
  return (
    <div className="empty-state" style={{ padding: 60 }}>
      <div className="spinner" />
    </div>
  );
}

function guarded(moduleId, Component) {
  return (
    <ProtectedRoute moduleId={moduleId}>
      <Suspense fallback={<PageFallback />}>
        <Component />
      </Suspense>
    </ProtectedRoute>
  );
}

export default function AppRoutes() {
  return (
    <Routes>
      {/* Public landing page (Checkpoint: public landing page). Landing
          itself redirects an already-signed-in visitor on to their
          dashboard, so this route needs no ProtectedRoute/guard wrapper —
          it's the one page that must be reachable without a session. */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
        <Route path="/dashboard" element={guarded('dashboard', Dashboard)} />
        <Route path="/incident-feed" element={guarded('incident-feed', IncidentFeed)} />
        {/* Checkpoint 28 — /residents route removed with the Resident
            Registry module. */}
        <Route path="/mapping" element={guarded('mapping', Mapping)} />
        <Route path="/analytics" element={guarded('analytics', Analytics)} />
        <Route path="/trends" element={guarded('trends', Trends)} />
        {/* Records module (Checkpoint 19, Tasks 2/3): landing page offers
            Criminal Record / Victim Record. Both list routes below reuse the
            existing CriminalRecords/VictimRecords implementations; the
            detail routes are unchanged so any existing bookmarks/links to a
            specific criminal or victim profile keep working. */}
        <Route path="/criminal-records" element={guarded('criminal-records', Records)} />
        <Route path="/criminal-records/criminal" element={guarded('criminal-records', CriminalRecords)} />
        <Route path="/criminal-records/victim" element={guarded('criminal-records', VictimRecords)} />
        <Route path="/criminal-records/victims/:id" element={guarded('criminal-records', VictimProfile)} />
        <Route path="/criminal-records/:id" element={guarded('criminal-records', CriminalProfile)} />
        <Route path="/audit-logs" element={guarded('audit-logs', AuditLogs)} />
        <Route path="/user-management" element={guarded('user-management', UserManagement)} />
        <Route path="/settings" element={guarded('settings', Settings)} />
        {/* Checkpoint 28 — /security route removed; its Two-Factor
            Authentication content moved into /user-management (see
            UserManagement.jsx). No other route depended on /security. */}
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
