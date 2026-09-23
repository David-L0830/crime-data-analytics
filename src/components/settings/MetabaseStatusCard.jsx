import { useCallback, useEffect, useState } from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { Icons } from '../icons';
import { settingsService } from '../../services/settingsService';
import { ApiError } from '../../services/api';
import { metabaseStatusSummary } from '../../utils/metabaseStatus';

// Metabase Embedding — read-only, System Settings (Super Administrator).
//
// Shows whether embedding is configured: the site URL, each dashboard ID, and
// whether the embedding secret is SET. It never shows the secret, and there is
// nothing to edit here on purpose. All of these values are environment
// variables on the backend host (METABASE_*), so a change is made there and
// takes effect on the next deploy; the browser never holds a value that can
// sign an embed.
const configuredLabel = (ok) => (ok ? 'Configured' : 'Not configured');

export default function MetabaseStatusCard() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    settingsService
      .metabaseStatus()
      .then(setStatus)
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : 'Unable to load the Metabase status. Please try again.',
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  return (
    <Card
      title="Metabase Embedding"
      actions={
        <Button size="sm" variant="secondary" onClick={load} disabled={loading}>
          <Icons.Sync size={14} strokeWidth={2} /> Refresh
        </Button>
      }
    >
      {loading && !status ? (
        <p className="settings-note" role="status">
          Loading Metabase status…
        </p>
      ) : error ? (
        <p className="settings-note" role="alert">
          {error}
        </p>
      ) : status ? (
        <>
          <p className="settings-note" role="status">
            {metabaseStatusSummary(status)}
          </p>
          <dl className="metabase-status-list">
            <dt>Site URL</dt>
            <dd>{status.siteUrl ?? <Badge status="Not configured" />}</dd>
            <dt>Embedding secret key</dt>
            <dd>
              <Badge status={configuredLabel(status.embeddingSecretConfigured)} />
            </dd>
            {status.dashboards.map((dashboard) => (
              <DashboardRow key={dashboard.key} dashboard={dashboard} />
            ))}
            <dt>Signed embed lifetime</dt>
            <dd>{Math.round(status.tokenTtlSeconds / 60)} minutes</dd>
          </dl>
          <p className="settings-note">
            Read-only. These values are environment variables on the backend
            host (METABASE_SITE_URL, METABASE_EMBEDDING_SECRET_KEY,
            METABASE_DASHBOARD_ID_*) and are changed there, never here. The
            secret key is never shown.
          </p>
        </>
      ) : null}
    </Card>
  );
}

function DashboardRow({ dashboard }) {
  return (
    <>
      <dt>{dashboard.label}</dt>
      <dd>
        {dashboard.configured ? (
          `Dashboard #${dashboard.id}`
        ) : (
          <Badge status="Not configured" />
        )}
      </dd>
    </>
  );
}
