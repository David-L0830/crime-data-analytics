import { useEffect, useState } from 'react';
import { metabaseService } from '../services/metabaseService';
import { Icons } from './icons';

// Renders a signed Metabase dashboard inside an iframe. Fetches a
// fresh, short-lived embed URL from the Laravel API on mount (and
// whenever `dashboardKey` changes) — the actual Metabase secret never
// reaches this component; it only ever receives the finished URL.
export default function MetabaseDashboard({
  dashboardKey,
  filters = {},
  title,
  height = 800,
}) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    metabaseService
      .embedUrl(dashboardKey, filters)
      .then((data) => {
        if (!cancelled) setUrl(data?.url || null);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err.message || 'Unable to load analytics dashboard.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardKey, filterKey]);

  if (loading) {
    return (
      <div
        className="card"
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="spinner" />
      </div>
    );
  }

  if (error || !url) {
    return (
      <div
        className="card"
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="empty-state" style={{ padding: '16px 24px' }}>
          <div className="empty-icon">
            <Icons.BarChart3 size={28} strokeWidth={1.5} />
          </div>
          <p style={{ color: 'var(--text-muted)' }}>
            {error || 'Analytics dashboard is not available right now.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {title && <h3 style={{ padding: '16px 16px 0' }}>{title}</h3>}
      <iframe
        src={url}
        title={title || dashboardKey}
        width="100%"
        height={height}
        style={{ border: 'none' }}
        allowTransparency="true"
      />
    </div>
  );
}
