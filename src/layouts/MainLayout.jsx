import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar';
import Header from '../components/layout/Header';
import { useData } from '../hooks/useData';

export default function MainLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { loading, error } = useData();

  // DataContext only ever sets `error` for a genuine problem now — a
  // 401 (session expired / MFA-required) is handled by signing the
  // person out and sending them back to Login, not by landing here (see
  // DataContext.jsx). So what's left really is: the server couldn't be
  // reached at all ('network'), or it was reached and returned a real
  // problem ('server', 'unknown', etc.) — those get different wording so
  // this banner is never misleading about which one happened.
  const errorMessage = error
    ? error.type === 'network'
      ? `Could not reach the server: ${error.message}`
      : error.message
    : null;

  const handleMenuToggle = () => {
    if (window.innerWidth <= 768) {
      setMobileOpen((o) => !o);
    } else {
      setSidebarCollapsed((c) => !c);
    }
  };

  return (
    <div className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar open={mobileOpen} collapsed={sidebarCollapsed} onNavigate={() => setMobileOpen(false)} />
      <main className="main-content">
        <Header onMenuToggle={handleMenuToggle} />
        <div className="content-area">
          {errorMessage && (
            <div className="login-error" style={{ margin: '0 0 16px' }}>
              {errorMessage}
            </div>
          )}
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading dashboard data…
            </div>
          ) : (
            <Outlet />
          )}
        </div>
      </main>
    </div>
  );
}
