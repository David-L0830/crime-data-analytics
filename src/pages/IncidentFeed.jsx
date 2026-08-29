import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useData } from '../hooks/useData';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { useDebounce } from '../hooks/useDebounce';
import FilterBar from '../components/ui/FilterBar';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import PrintReport, { PrintDocumentEnd } from '../components/ui/PrintReport';
import {
  IncidentViewModal,
  IncidentEditModal,
  IncidentCreateModal,
} from '../components/incidents/IncidentModal';
import {
  filterRecords,
  formatDate,
  formatTime,
  today,
  SOLVED_STATUSES,
  PENDING_STATUSES,
} from '../utils/helpers';
import { exportWorkbook } from '../utils/exportWorkbook';
import { auditLogService } from '../services/auditLogService';
import { TYPE_CATEGORY_MAP } from '../utils/constants';
import { Icons } from '../components/icons';

export default function IncidentFeed() {
  const {
    records,
    SITIOS,
    CRIME_TYPES,
    CATEGORIES,
    STATUSES,
    validateRecord,
    updateRecord,
    archiveRecord,
    addRecord,
  } = useData();
  const { can, currentUser } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();

  const [filters, setFilters] = useState(() => {
    const incoming = location.state?.filters;
    if (!incoming) return {};
    return {
      'inc-crimeType': incoming.crimeType,
      'inc-sitio': incoming.sitio,
      'inc-status': incoming.status,
      'inc-dateFrom': incoming.dateFrom,
      'inc-dateTo': incoming.dateTo,
    };
  });
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  // Bumped whenever the filters are cleared programmatically (see the
  // notification-arrival effect below) and used as the FilterBar's key.
  // FilterBar holds its selections in its own state, seeded from
  // initialValues on mount only, so clearing this page's `filters` alone
  // would leave the bar still displaying the old selections while nothing
  // was actually filtered. Remounting it is the smallest fix that keeps the
  // control and the applied filters agreeing, and it touches only this page
  // — the shared FilterBar and its other four callers are unchanged.
  const [filterResetKey, setFilterResetKey] = useState(0);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [archivingId, setArchivingId] = useState(null);

  // Arriving from a notification click (e.g. "Case Resolved" / "Overdue
  // Case") carries the referenced case number in router state — pre-fill the
  // search box with it so the record is immediately visible.
  //
  // The FilterBar selections are cleared at the same time. Filter state
  // survives navigation, so without this a case reached from a "Case
  // Resolved" notification would be hidden whenever a Status filter of
  // "Open" happened to still be applied from earlier in the session: the
  // notification would say the case was solved and the list it opened would
  // appear to contain no such case. Clearing only happens on this specific
  // arrival, so filters the user set on this screen are otherwise untouched.
  useEffect(() => {
    if (location.state?.search) {
      setSearch(location.state.search);
      setFilters({});
      setFilterResetKey((k) => k + 1);
    }
  }, [location.state]);

  const filtered = useMemo(() => {
    const results = filterRecords(records, {
      crimeType: filters['inc-crimeType'],
      category: filters['inc-category'],
      sitio: filters['inc-sitio'],
      status: filters['inc-status'],
      dateFrom: filters['inc-dateFrom'],
      dateTo: filters['inc-dateTo'],
      search: debouncedSearch,
    });
    // Checkpoint 20, Task 14 — the default operational list should show
    // active records; Archived incidents remain stored and retrievable
    // by explicitly selecting "Archived" in the Status filter above.
    const withArchiveRule = filters['inc-status']
      ? results
      : results.filter((r) => r.status !== 'Archived');
    const group = location.state?.statusGroup;
    if (group === 'solved')
      return withArchiveRule.filter((r) => SOLVED_STATUSES.includes(r.status));
    if (group === 'pending')
      return withArchiveRule.filter((r) => PENDING_STATUSES.includes(r.status));
    return withArchiveRule;
  }, [records, filters, debouncedSearch, location.state]);

  // BADAC Administrator may edit any record; an Encoder may only correct
  // incidents they personally encoded (Part H-30 of the RBAC spec). The
  // backend enforces the same rule independently — this is just so the
  // Encoder isn't shown an Edit action that will 403.
  const canEditRecord = (record) =>
    can('edit_any_record') ||
    (can('edit_own_incident') && record.reportedBy === currentUser?.id);

  const handleEdit = (record) => {
    if (!canEditRecord(record)) {
      showToast(
        'You may only update incidents you personally encoded.',
        'error',
      );
      return;
    }
    setViewing(null);
    setEditing(record);
  };

  // In this UI only BADAC Administrator sees the Archive action: Encoder has
  // no 'archive_own_incident' entry in PERMISSIONS (constants.js), so the
  // second clause always evaluates false for that role.
  //
  // This is a frontend restriction only — the backend route is
  // role:badac_admin,encoder and lets an Encoder archive an incident they
  // personally encoded (ownership checked in IncidentController::archive()).
  // The second clause below is kept because it is what would grant the
  // action if that permission is ever restored. See the note in constants.js.
  const canArchiveRecord = (record) =>
    can('archive_record') ||
    (can('archive_own_incident') && record.reportedBy === currentUser?.id);

  const handleArchive = async (record) => {
    if (!canArchiveRecord(record)) {
      showToast(
        'You may only archive incidents you personally encoded.',
        'error',
      );
      return;
    }
    if (archivingId) return; // prevent duplicate requests while one is in flight
    if (
      !window.confirm(
        'Archive this record? It will be removed from the active list but kept on file and can still be found via the Status filter.',
      )
    ) {
      return;
    }
    setArchivingId(record.id);
    try {
      await archiveRecord(record.id);
      showToast('Incident archived', 'success');
      if (viewing?.id === record.id) setViewing(null);
    } catch (err) {
      showToast(err.message || 'Could not archive incident', 'error');
    } finally {
      setArchivingId(null);
    }
  };

  const handleSave = async (id, data) => {
    try {
      await updateRecord(id, data);
      setEditing(null);
      showToast('Incident updated', 'success');
    } catch (err) {
      showToast(err.message || 'Could not update incident', 'error');
    }
  };

  // One definition, consumed by the printed report header and the Excel
  // metadata line, so the document and the workbook always describe the same
  // filter state. Same pattern as Dashboard / Statistical Analysis / Trends.
  const filterSummary = [
    `From: ${filters['inc-dateFrom'] || 'Any'}`,
    `To: ${filters['inc-dateTo'] || 'Any'}`,
    `Crime Type: ${filters['inc-crimeType'] || 'All'}`,
    `Category: ${filters['inc-category'] || 'All'}`,
    `Sitio: ${filters['inc-sitio'] || 'All'}`,
    `Status: ${filters['inc-status'] || 'All'}`,
    `Search: ${debouncedSearch || 'None'}`,
  ].join(' \u00B7 ');

  // Real .xlsx through the shared exportWorkbook helper, replacing a raw CSV
  // dump that carried internal plumbing (id, reportedBy, synced_at,
  // latitude/longitude) and wrote dates as text Excel would not sort. The
  // columns below are an explicit, ordered projection of the SAME `filtered`
  // records the table above is showing - search and every active filter
  // already applied. No underlying record value is altered.
  const handleExportExcel = async () => {
    const ok = await exportWorkbook({
      filename: `incidents_${today()}.xlsx`,
      sheetName: 'Crime Data Collection',
      title: 'Crime Data Collection Report',
      subtitle: 'Crime Data Analytics & Reporting System',
      meta: [`Filters: ${filterSummary}`],
      columns: [
        { header: 'Case Number', key: 'caseNumber', width: 16 },
        { header: 'Date', key: 'date', type: 'date', width: 14 },
        {
          header: 'Time',
          key: 'time',
          width: 10,
          align: 'center',
          value: (r) => formatTime(r.time),
        },
        { header: 'Crime Type', key: 'crimeType', width: 20 },
        { header: 'Category', key: 'category', width: 18 },
        { header: 'Sitio', key: 'sitio', width: 14 },
        { header: 'Street / Location', key: 'street', width: 28, wrap: true },
        { header: 'Status', key: 'status', width: 18, align: 'center' },
        { header: 'Priority', key: 'priority', width: 12, align: 'center' },
        { header: 'Reporting Officer', key: 'reportingOfficer', width: 22 },
        {
          header: 'Investigating Officer',
          key: 'investigatingOfficer',
          width: 22,
        },
        { header: 'Victim', key: 'victimName', width: 22 },
        { header: 'Victim Age', key: 'victimAge', type: 'number', width: 11 },
        {
          header: 'Victim Gender',
          key: 'victimGender',
          width: 13,
          align: 'center',
        },
        { header: 'Suspect', key: 'suspectName', width: 22 },
        { header: 'Description', key: 'description', width: 40, wrap: true },
      ],
      rows: filtered,
      onEmpty: () => showToast('No data to export', 'error'),
      onError: () => showToast('Could not export report.', 'error'),
    });
    if (ok) {
      showToast('Incidents exported to Excel', 'success');
      // Recorded only on success, so the audit trail never claims an
      // export that did not happen. Not awaited: a completed download
      // must not wait on, or be failed by, follow-up bookkeeping.
      auditLogService.logExport('incidents');
    }
  };

  const handleCreate = async (data) => {
    try {
      await addRecord(data);
      setCreating(false);
      showToast('Incident recorded', 'success');
    } catch (err) {
      showToast(err.message || 'Could not save incident', 'error');
    }
  };

  return (
    <section className="module print-root">
      {/* Crime Data Collection had no printable document at all: no shared
          header, no page numbering, and the browser's own print output of the
          screen UI. It now renders the same PrintReport foundation every other
          module uses, so a printed incident list is an official A4 document
          rather than a screenshot of a web page. */}
      <PrintReport
        title="Crime Data Collection Report"
        subtitle="Crime Data Analytics &amp; Reporting System"
        meta={[
          `${filtered.length} record${filtered.length === 1 ? '' : 's'}`,
          filterSummary,
        ]}
      >

        <div className="module-toolbar">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search case number, location, officer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="toolbar-actions">
            {/* Checkpoint 27 — overall CSV export. Exports `filtered` (search +
                every active FilterBar field already applied above), matching
                this app's established export convention on every other module
                (Dashboard, Analytics, AuditLogs, Residents, CriminalRecords,
                VictimRecords all export their own `filtered`, not the raw
                unfiltered dataset) — there is no pagination on this table to
                worry about accidentally under-exporting from. This is
                deliberately separate from the per-incident "VIEW -> Export
                PDF" flow in IncidentModal, which exports only that one
                record. */}
            <Button variant="secondary" onClick={handleExportExcel}>
              <Icons.Download size={15} strokeWidth={2} /> Export Excel
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              <Icons.Printer size={15} strokeWidth={2} /> Print Report
            </Button>
            {can('create_incident') && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Icons.ClipboardList size={15} strokeWidth={2} /> New Incident
              </Button>
            )}
          </div>
        </div>

        <FilterBar
          key={filterResetKey}
          fields={[
            {
              id: 'inc-crimeType',
              label: 'Crime Type',
              type: 'select',
              options: CRIME_TYPES,
            },
            {
              id: 'inc-category',
              label: 'Category',
              type: 'select',
              options: CATEGORIES,
            },
            { id: 'inc-sitio', label: 'Sitio', type: 'select', options: SITIOS },
            {
              id: 'inc-status',
              label: 'Status',
              type: 'select',
              options: STATUSES,
            },
            { id: 'inc-dateFrom', label: 'From', type: 'date' },
            { id: 'inc-dateTo', label: 'To', type: 'date' },
          ]}
          onApply={setFilters}
          initialValues={filterResetKey === 0 ? filters : {}}
        />

        {/* Print-only section heading, so the printed table is introduced
            rather than beginning abruptly under the document header. */}
        <h2 className="print-section-heading print-only">Incident Records</h2>

        <Card bodyClassName="table-wrap incident-report-table">
          <Table
            columns={[
              { key: 'caseNumber', label: 'Case #' },
              { key: 'crimeType', label: 'Type' },
              { key: 'category', label: 'Category' },
              { key: 'date', label: 'Date', render: formatDate },
              { key: 'time', label: 'Time', render: formatTime },
              { key: 'sitio', label: 'Sitio' },
              { key: 'street', label: 'Location' },
              { key: 'reportingOfficer', label: 'Reporting Officer' },
              { key: 'status', label: 'Status' },
            ]}
            rows={filtered}
            actions={(row) => (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setViewing(row)}
                >
                  View
                </Button>
                {canArchiveRecord(row) && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => handleArchive(row)}
                    disabled={archivingId === row.id}
                  >
                    {archivingId === row.id ? 'Archiving…' : 'Archive'}
                  </Button>
                )}
              </>
            )}
          />
        </Card>

        <PrintDocumentEnd />

      </PrintReport>

      <IncidentViewModal
        incident={viewing}
        onClose={() => setViewing(null)}
        onEdit={viewing && canEditRecord(viewing) ? handleEdit : null}
        onArchive={viewing && canArchiveRecord(viewing) ? handleArchive : null}
        archiving={viewing && archivingId === viewing.id}
      />
      <IncidentEditModal
        incident={editing}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        onSave={handleSave}
        crimeTypes={CRIME_TYPES}
        categories={CATEGORIES}
        sitios={SITIOS}
        statuses={STATUSES}
        typeCategoryMap={TYPE_CATEGORY_MAP}
        validate={validateRecord}
      />
      <IncidentCreateModal
        open={creating}
        onClose={() => setCreating(false)}
        onSave={handleCreate}
        crimeTypes={CRIME_TYPES}
        categories={CATEGORIES}
        sitios={SITIOS}
        statuses={STATUSES}
        typeCategoryMap={TYPE_CATEGORY_MAP}
        validate={validateRecord}
      />
    </section>
  );
}
