import { useEffect, useRef, useState } from 'react';
import { metabaseService } from '../../services/metabaseService';
import { Icons } from '../icons';

// Reusable secure Metabase dashboard embed, used by Dashboard.jsx,
// Analytics.jsx, and Trends.jsx in place of their old Chart.js sections.
//
//   <MetabaseDashboard dashboardKey="crime-dashboard" filters={baseFilters} title="Crime Overview" />
//
// dashboardKey — one of 'crime-dashboard' | 'crime-analytics' | 'crime-trends'
//   (must match a key MetabaseController::ALLOWED_DASHBOARDS recognizes).
// filters — the page's own filter-bar state, forwarded to the backend so it
//   can lock matching Metabase dashboard parameters (see metabaseService).
// title — optional card heading; also used as the iframe's accessible name.
// height — px height of the embedded dashboard area (default 900, since a
//   Metabase dashboard bundles several visualizations, not just one chart).
//
// The Metabase embedding secret key never reaches this component or the
// browser at all — it only ever sees the finished, already-signed URL the
// backend returns.
const REFRESH_INTERVAL_MS = 8 * 60 * 1000; // re-sign before the backend's 10-minute token expiry

export default function MetabaseDashboard({ dashboardKey, filters = {}, title, height = 900 }) {
  const [state, setState] = useState({ status: 'loading', url: null, message: null });
  const filterKey = JSON.stringify(filters);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    const load = (isRefresh) => {
      if (!isRefresh) setState({ status: 'loading', url: null, message: null });
      metabaseService.getEmbedUrl(dashboardKey, filters)
        .then((res) => {
          if (cancelled || !mountedRef.current) return;
          if (!res?.url) {
            setState({ status: 'error', url: null, message: 'Metabase did not return an embed URL.' });
            return;
          }
          setState({ status: 'ready', url: res.url, message: null });
        })
        .catch((err) => {
          if (cancelled || !mountedRef.current) return;
          // A silent background refresh failing shouldn't yank away a
          // dashboard that's already on screen and working.
          if (isRefresh) return;
          setState({
            status: 'error',
            url: null,
            message: err?.status === 503 || err?.status === 422
              ? (err.message || 'Metabase is not configured yet.')
              : (err?.message || 'Could not load the Metabase dashboard.'),
          });
        });
    };

    load(false);
    const interval = setInterval(() => load(true), REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardKey, filterKey]);

  useEffect(() => () => { mountedRef.current = false; }, []);

  return (
    <div className="card metabase-embed-card print-hidden">
      {title && <h3>{title}</h3>}

      {state.status === 'loading' && (
        <div className="metabase-embed-loading" style={{ minHeight: Math.min(height, 400) }}>
          <div className="spinner" />
        </div>
      )}

      {state.status === 'error' && (
        <div className="empty-state metabase-embed-error" style={{ minHeight: Math.min(height, 400) }}>
          <div className="empty-icon"><Icons.BarChart3 size={28} strokeWidth={1.5} /></div>
          <p style={{ color: 'var(--text-muted)' }}>{state.message}</p>
        </div>
      )}

      {state.status === 'ready' && (
        <div className="metabase-embed-frame-wrap" style={{ minHeight: height }}>
          <iframe
            key={state.url}
            src={state.url}
            title={title || dashboardKey}
            style={{ minHeight: height }}
            allow="fullscreen"
          />
        </div>
      )}
    </div>
  );
}
