import { useMemo, useState } from 'react';
import { useData } from '../hooks/useData';
import { useToast } from '../hooks/useToast';
import FilterBar from '../components/ui/FilterBar';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import { today } from '../utils/helpers';
import { exportWorkbook } from '../utils/exportWorkbook';
import { auditLogService } from '../services/auditLogService';
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
// RESTORE joins ARCHIVE as a filter choice: Criminal and Victim records can
// now be restored from the archive (CriminalController::restore() /
// VictimController::restore() each write an AuditLog row with action
// 'RESTORE'), and undoing an archive is exactly the kind of event an
// administrator reviews the trail for. Purely additive — no existing action
// value changes and no historical row is affected.
const ACTIONS = [
  'LOGIN',
  'LOGOUT',
  'REPORT_GENERATED',
  'REPORT_EXPORTED',
  'UPDATE',
  'ARCHIVE',
  'RESTORE',
  'SYNC_COMPLETED',
];
// Aligned with the target types the backend actually writes. 'resident' is
// gone: the residents table was dropped and no ResidentController remains, so
// nothing has emitted that value since — it could only ever match rows the
// audit seeder fabricated, and that seeder no longer exists.
//
// The five added values were already being written and simply had no filter:
// criminal, victim, crime_type, evidence and settings. Without them an
// administrator could not narrow the trail to criminal-record or victim
// activity at all, which is a large part of what the trail is reviewed for.
//
// Removing 'resident' from this list does NOT hide historical rows. The filter
// is opt-in — an unset filter matches everything — so any resident row already
// in the database keeps rendering in the table, and ACTION_COLORS still colours
// its action. Same treatment DELETE and CREATE already get above: retired as a
// filter choice, never erased from the record.
const TARGET_TYPES = [
  'auth',
  'report',
  'user',
  'incident',
  'criminal',
  'victim',
  'crime_type',
  'evidence',
  'settings',
];

const ACTION_COLORS = {
  LOGIN: 'var(--accent)',
  LOGOUT: 'var(--warning)',
  SYNC_STARTED: 'var(--info)',
  SYNC_COMPLETED: 'var(--success)',
  SYNC_FAILED: 'var(--danger)',
  REPORT_GENERATED: 'var(--accent)',
  REPORT_EXPORTED: 'var(--accent)',
  CREATE: 'var(--success)',
  UPDATE: 'var(--info)',
  ARCHIVE: 'var(--warning)',
  // Restoring returns a record to service, so it reads as a success/positive
  // action — same token CREATE uses, and deliberately distinct from ARCHIVE's
  // warning tone so the two sides of the pair are easy to tell apart.
  RESTORE: 'var(--success)',
  // DELETE kept so any historical DELETE audit entries still render with a
  // color instead of falling back to plain text — it's just no longer a
  // filter option (removed from ACTIONS above) or something new code emits.
  DELETE: 'var(--danger)',
};

import { useLocation } from 'react-router-dom';
// ...(add to existing import block)

export default function AuditLogs() {
  const { auditLogs, secondaryLoading } = useData();
  const { showToast } = useToast();
  const location = useLocation();
  const [filters, setFilters] = useState(() => {
    const incoming = location.state?.filters;
    if (!incoming) return {};
    return {
      'audit-action': incoming.action,
      'audit-dateFrom': incoming.dateFrom,
      'audit-dateTo': incoming.dateTo,
    };
  });

  const filtered = useMemo(
    () =>
      auditLogs
        .filter((log) => {
          if (filters['audit-action'] && log.action !== filters['audit-action'])
            return false;
          if (
            filters['audit-target'] &&
            log.targetType !== filters['audit-target']
          )
            return false;
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
          if (
            filters['audit-dateFrom'] &&
            log.timestamp < filters['audit-dateFrom']
          )
            return false;
          if (
            filters['audit-dateTo'] &&
            log.timestamp > `${filters['audit-dateTo']}T23:59:59`
          )
            return false;
          return true;
        })
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 200),
    [auditLogs, filters],
  );

  // Real .xlsx through the shared exportWorkbook helper. The previous CSV
  // dumped the raw log objects, including the internal database id, and wrote
  // the timestamp as a raw ISO string that Excel treats as text - so the one
  // column an audit log is most often sorted by could not be sorted. It is
  // written as a real date-time here, and the id, which identifies nothing
  // outside this database, is left out.
  const handleExportLogs = async () => {
    const ok = await exportWorkbook({
      filename: `audit_logs_${today()}.xlsx`,
      sheetName: 'Audit Logs',
      title: 'Audit Log Report',
      subtitle: 'Crime Data Analytics & Reporting System',
      meta: [
        `Action: ${filters['audit-action'] || 'All'}`,
        `Target Type: ${filters['audit-target'] || 'All'}`,
        `From: ${filters['audit-dateFrom'] || 'Any'}`,
        `To: ${filters['audit-dateTo'] || 'Any'}`,
      ],
      columns: [
        {
          header: 'Date / Time',
          key: 'timestamp',
          type: 'date',
          width: 22,
          numFmt: 'dd mmm yyyy hh:mm',
        },
        { header: 'Action', key: 'action', width: 18, align: 'center' },
        { header: 'Performed By', key: 'performedBy', width: 24 },
        { header: 'Role', key: 'role', width: 18 },
        { header: 'Target Type', key: 'targetType', width: 18 },
        { header: 'Details', key: 'details', width: 60, wrap: true },
      ],
      rows: filtered,
      onEmpty: () => showToast('No data to export', 'error'),
      onError: () => showToast('Could not export report.', 'error'),
    });
    if (ok) {
      showToast('Audit logs exported to Excel', 'success');
      // Recorded only on success, so the audit trail never claims an
      // export that did not happen. Not awaited: a completed download
      // must not wait on, or be failed by, follow-up bookkeeping.
      auditLogService.logExport('audit-logs');
    }
  };

  return (
    <section className="module">
      <div className="module-toolbar">
        <h2 className="module-toolbar-title">
          <Icons.Report size={18} strokeWidth={2} /> Audit Logs
        </h2>
        <Button variant="secondary" onClick={handleExportLogs}>
          <Icons.Download size={15} strokeWidth={2} /> Export Logs
        </Button>
      </div>

      <FilterBar
        fields={[
          {
            id: 'audit-action',
            label: 'Action',
            type: 'select',
            options: ACTIONS,
          },
          {
            id: 'audit-target',
            label: 'Target Type',
            type: 'select',
            options: TARGET_TYPES,
          },
          { id: 'audit-dateFrom', label: 'From', type: 'date' },
          { id: 'audit-dateTo', label: 'To', type: 'date' },
        ]}
        onApply={setFilters}
      />

      <Card bodyClassName="table-wrap">
        <Table
          columns={[
            {
              key: 'timestamp',
              label: 'Date/Time',
              render: (v) => new Date(v).toLocaleString('en-PH'),
            },
            {
              key: 'action',
              label: 'Action',
              render: (v) => (
                <span
                  style={{
                    color: ACTION_COLORS[v] || 'inherit',
                    fontWeight: 600,
                  }}
                >
                  {v}
                </span>
              ),
            },
            { key: 'performedBy', label: 'Performed By' },
            { key: 'targetType', label: 'Target Type' },
            { key: 'details', label: 'Details' },
          ]}
          rows={filtered}
          emptyMessage={
            secondaryLoading
              ? 'Loading audit logs…'
              : 'No audit log entries match the current filters.'
          }
        />
      </Card>
    </section>
  );
}
