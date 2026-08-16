import { useMemo, useState } from 'react';
import { useData } from '../hooks/useData';
import { useToast } from '../hooks/useToast';
import FilterBar from '../components/ui/FilterBar';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import { exportCSV, today } from '../utils/helpers';
import { Icons } from '../components/icons';

// Checkpoint 19, Task 2 (frontend) + Checkpoint 20 (backend): the filter
// dropdown offers ARCHIVE instead of DELETE, since Delete→Archive is the
// user-facing action. This does NOT touch historical data — any DELETE
// entries already in auditLogs are untouched and keep rendering
// (ACTION_COLORS below still maps DELETE) — they're just not offered as a
// *filter choice* anymore. As of Checkpoint 20 the backend also actually
// emits ARCHIVE for new archive operations (IncidentController::archive(),
// ResidentController::archive(), VictimController::archive() each write an
// AuditLog row with action 'ARCHIVE') — this is no longer deferred.
// Checkpoint 29 — CREATE removed as a *filter choice* the same way, and for
// the same reason: it's not a value someone filters an audit trail by day
// to day. ACTION_COLORS below still maps CREATE so any historical CREATE
// rows already in the database keep rendering with their color; nothing
// server-side writes fewer CREATE rows and no existing row's action value
// changes — this only narrows the dropdown.
const ACTIONS = ['LOGIN', 'LOGOUT', 'REPORT_GENERATED', 'REPORT_EXPORTED', 'UPDATE', 'ARCHIVE'];
const TARGET_TYPES = ['auth', 'report', 'user', 'resident', 'incident'];

const ACTION_COLORS = {
  LOGIN: 'var(--accent)', LOGOUT: 'var(--warning)', SYNC_STARTED: 'var(--info)', SYNC_COMPLETED: 'var(--success)',
  SYNC_FAILED: 'var(--danger)', REPORT_GENERATED: 'var(--accent)', REPORT_EXPORTED: 'var(--accent)',
  CREATE: 'var(--success)', UPDATE: 'var(--info)', ARCHIVE: 'var(--warning)',
  // DELETE kept so any historical DELETE audit entries still render with a
  // color instead of falling back to plain text — it's just no longer a
  // filter option (removed from ACTIONS above) or something new code emits.
  DELETE: 'var(--danger)',
};

export default function AuditLogs() {
  const { auditLogs } = useData();
  const { showToast } = useToast();
  const [filters, setFilters] = useState({});

  const filtered = useMemo(() => auditLogs.filter((log) => {
    if (filters['audit-action'] && log.action !== filters['audit-action']) return false;
    if (filters['audit-target'] && log.targetType !== filters['audit-target']) return false;
    // Checkpoint 26 — verified: log.timestamp is an ISO string with a fixed
    // +08:00 offset (AuditLogResource::toArray -> Carbon::toIso8601String(),
    // app.timezone is 'Asia/Manila' — see backend/config/app.php — which has
    // no DST, so the offset never changes). String comparison against the
    // plain 'YYYY-MM-DD' filter values is safe here: a same-offset ISO
    // string is lexically ordered identically to its chronological order,
    // and a shorter date-only prefix always sorts before any same-day
    // timestamp that extends it, so the FROM boundary is naturally
    // inclusive without needing a 'T00:00:00' suffix. No UTC/local
    // conversion bug — the appended 'T23:59:59' below make the TO boundary
    // explicitly inclusive too.
    if (filters['audit-dateFrom'] && log.timestamp < filters['audit-dateFrom']) return false;
    if (filters['audit-dateTo'] && log.timestamp > `${filters['audit-dateTo']}T23:59:59`) return false;
    return true;
  }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 200), [auditLogs, filters]);

  return (
    <section className="module">
      <div className="module-toolbar">
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><Icons.Report size={18} strokeWidth={2} /> Audit Logs</h2>
        <Button
          variant="secondary"
          onClick={() => { if (exportCSV(filtered, `audit_logs_${today()}.csv`, () => showToast('No data to export', 'error'))) showToast('Audit logs exported', 'success'); }}
        >
          <Icons.Download size={15} strokeWidth={2} /> Export Logs
        </Button>
      </div>

      <FilterBar
        fields={[
          { id: 'audit-action', label: 'Action', type: 'select', options: ACTIONS },
          { id: 'audit-target', label: 'Target Type', type: 'select', options: TARGET_TYPES },
          { id: 'audit-dateFrom', label: 'From', type: 'date' },
          { id: 'audit-dateTo', label: 'To', type: 'date' },
        ]}
        onApply={setFilters}
      />

      <Card bodyClassName="table-wrap">
        <Table
          columns={[
            { key: 'timestamp', label: 'Date/Time', render: (v) => new Date(v).toLocaleString('en-PH') },
            { key: 'action', label: 'Action', render: (v) => <span style={{ color: ACTION_COLORS[v] || 'inherit', fontWeight: 600 }}>{v}</span> },
            { key: 'performedBy', label: 'Performed By' },
            { key: 'targetType', label: 'Target Type' },
            { key: 'details', label: 'Details' },
          ]}
          rows={filtered}
        />
      </Card>
    </section>
  );
}
