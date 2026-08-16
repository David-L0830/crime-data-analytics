// Renders a status pill using the original `.status-badge status-<Status>` classes.
export default function Badge({ status }) {
  const cls = `status-badge status-${String(status || 'Unknown').replace(/\s+/g, '-')}`;
  return <span className={cls}>{status || '—'}</span>;
}
