import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useData } from '../hooks/useData';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { usePendingAction } from '../hooks/usePendingAction';
import { useDebounce } from '../hooks/useDebounce';
import useTableSort from '../hooks/useTableSort';
import FilterBar from '../components/ui/FilterBar';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import ValidationBadge from '../components/ui/ValidationBadge';
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
import { exportCsv } from '../utils/exportCsv';
import { auditLogService } from '../services/auditLogService';
import {
  TYPE_CATEGORY_MAP,
  ASSIGNABLE_STATUSES,
  VALIDATION_STATUS_LABELS,
} from '../utils/constants';
import { Icons } from '../components/icons';

// The Validation filter offers the human labels (FilterBar options are plain
// strings); this maps a chosen label back to the API value it filters on.
const VALIDATION_KEY_BY_LABEL = Object.fromEntries(
  Object.entries(VALIDATION_STATUS_LABELS).map(([key, label]) => [label, key]),
);

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
    restoreRecord,
    approveRecord,
    returnRecordForCorrection,
    addRecord,
    holdRecordsRefresh,
    unreadValidationCount,
    markAllNotificationsRead,
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
  const [restoringId, setRestoringId] = useState(null);
  const [reviewingId, setReviewingId] = useState(null);
  const [openingValidation, setOpeningValidation] = useState(false);

  // The background poll replaces `records` wholesale (see DataContext's
  // refreshRecords). That must not happen while a record is open for reading,
  // editing or creation, or the object behind the modal would change under the
  // person using it. Holding is advisory only — it delays a refresh, never a
  // save — and a refresh wanted during the hold runs the moment it lifts.
  useEffect(() => {
    holdRecordsRefresh(Boolean(viewing || editing || creating));
  }, [viewing, editing, creating, holdRecordsRefresh]);

  // Leaving the page with a modal open must not leave the hold on forever.
  // Separate effect so it runs on unmount only — holdRecordsRefresh is a
  // stable useCallback, so this does not re-run as the modals open and close.
  useEffect(() => () => holdRecordsRefresh(false), [holdRecordsRefresh]);

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
    const archiveRuled = filters['inc-status']
      ? results
      : results.filter((r) => r.status !== 'Archived');
    // Validation is filtered here rather than in the shared filterRecords
    // helper, which also drives the Metabase-backed analytics pages and must
    // not change underneath them.
    const validationKey = VALIDATION_KEY_BY_LABEL[filters['inc-validation']];
    const withArchiveRule = validationKey
      ? archiveRuled.filter((r) => r.validationStatus === validationKey)
      : archiveRuled;
    const group = location.state?.statusGroup;
    if (group === 'solved')
      return withArchiveRule.filter((r) => SOLVED_STATUSES.includes(r.status));
    if (group === 'pending')
      return withArchiveRule.filter((r) => PENDING_STATUSES.includes(r.status));
    return withArchiveRule;
  }, [records, filters, debouncedSearch, location.state]);

  // Column sorting for this report. `sorted` — not `filtered` — is what the
  // table renders, what the printed document shows and what both exporters
  // project, so the order on screen and the order in the generated file are
  // the same order by construction. See useTableSort / sortRecords.
  const { sort, sorted, toggleSort, sortSummary } = useTableSort(filtered);

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

  // Inverse of handleArchive. PUT /incidents/{id}/restore carries the same
  // role:badac_admin,encoder + per-record ownership rule as archive
  // (IncidentController::restore()), so reusing canArchiveRecord's check
  // here mirrors CriminalRecords.jsx/VictimRecords.jsx's "whoever may
  // archive may restore" convention exactly.
  //
  // The confirmation names the exact status the record will return to. The
  // server is still the authority — it reads previous_status from the row —
  // but showing it here means the user is never confirming blind.
  const handleRestore = async (record) => {
    if (!canArchiveRecord(record)) {
      showToast(
        'You may only restore incidents you personally encoded.',
        'error',
      );
      return;
    }
    if (restoringId) return;
    const target = record.previousStatus || 'Open';
    if (
      !window.confirm(
        `Restore this incident? Its status will be set back to ${target} and it will reappear in the active list.`,
      )
    ) {
      return;
    }
    setRestoringId(record.id);
    try {
      await restoreRecord(record.id);
      showToast(`Incident restored to ${target}`, 'success');
      if (viewing?.id === record.id) setViewing(null);
    } catch (err) {
      showToast(err.message || 'Could not restore incident', 'error');
    } finally {
      setRestoringId(null);
    }
  };

  // Record validation — BADAC Administrator only. can('validate_record') is
  // UI gating; PUT /incidents/{id}/validate and /return are role:badac_admin,badac_validator
  // on the server and refuse everyone else with a 403.
  const canValidate = can('validate_record');

  // Active (non-archived) records awaiting action, for the review summary.
  const validationCounts = useMemo(() => {
    const active = records.filter((r) => r.status !== 'Archived');
    return {
      pending: active.filter((r) => r.validationStatus === 'pending').length,
      returned: active.filter((r) => r.validationStatus === 'returned').length,
    };
  }, [records]);

  // Opening Validation is a READ action and nothing more. It clears this
  // user's unread markers for the 'New Incident' announcements — the same
  // mechanism the Trends page's "Mark All as Read" uses for Hotspot Alerts —
  // and touches no incident at all: no validate call, no return call, no
  // status change. Records that were pending stay pending; the badge is about
  // what has been seen, not about what has been dealt with.
  //
  // CP-3 will open the validation drawer from here. Until then this is the
  // whole behaviour, deliberately.
  const handleOpenValidation = async () => {
    if (openingValidation) return;
    // Nothing unread means nothing to mark — skip the pointless request
    // rather than issuing a write that would change no row.
    if (unreadValidationCount === 0) return;

    setOpeningValidation(true);
    try {
      await markAllNotificationsRead('New Incident');
    } catch {
      // markAllNotificationsRead restores the previous list and rethrows, so
      // the badge comes back on failure. Say so rather than letting it look
      // like nothing happened.
      showToast(
        'Could not mark new incidents as read. Check your connection and try again.',
        'error',
      );
    } finally {
      setOpeningValidation(false);
    }
  };

  const handleApprove = async (record) => {
    if (!canValidate || reviewingId) return;
    setReviewingId(record.id);
    try {
      const updated = await approveRecord(record.id);
      showToast(`Case ${record.caseNumber} validated`, 'success');
      if (viewing?.id === record.id) setViewing(updated);
    } catch (err) {
      showToast(err.message || 'Could not validate the record', 'error');
    } finally {
      setReviewingId(null);
    }
  };

  const handleReturn = async (record, reason) => {
    if (!canValidate || reviewingId) return;
    setReviewingId(record.id);
    try {
      const updated = await returnRecordForCorrection(record.id, reason);
      showToast(`Case ${record.caseNumber} returned for correction`, 'success');
      if (viewing?.id === record.id) setViewing(updated);
    } catch (err) {
      showToast(err.message || 'Could not return the record', 'error');
    } finally {
      setReviewingId(null);
    }
  };

  const handleSave = async (id, data) => {
    try {
      await updateRecord(id, data);
      setEditing(null);
      showToast('Incident updated', 'success');
    } catch (err) {
      showToast(err.message || 'Could not update incident', 'error');
      // Re-thrown, not swallowed: the toast is gone in a few seconds and
      // cannot carry a 422's per-field messages. IncidentEditModal catches
      // this and renders err.errors inside the still-open form, which is
      // where the encoder is looking and where the offending field is.
      throw err;
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
    `Validation: ${filters['inc-validation'] || 'All'}`,
    `Search: ${debouncedSearch || 'None'}`,
  ].join(' \u00B7 ');

  // ONE projection, shared by the .xlsx and the .csv below, so the two files
  // can never drift apart: same columns, same order, same labels, same rows.
  //
  // The columns are an explicit, ordered projection of the SAME `sorted`
  // records the table above is showing - search, every active filter and the
  // chosen column ordering already applied. Internal plumbing (id, reportedBy,
  // synced_at, latitude/longitude) is simply not a reporting field, and no
  // underlying record value is altered.
  const exportSpec = () => ({
    sheetName: 'Crime Data Collection',
    title: 'Crime Data Collection Report',
    subtitle: 'Crime Data Analytics & Reporting System',
    meta: [`Filters: ${filterSummary}`, sortSummary],
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
      {
        header: 'Validation',
        key: 'validationStatus',
        width: 22,
        align: 'center',
        value: (r) =>
          VALIDATION_STATUS_LABELS[r.validationStatus] || r.validationStatus,
      },
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
    rows: sorted,
    onEmpty: () => showToast('No data to export', 'error'),
    onError: () => showToast('Could not export report.', 'error'),
  });

  // The SCOPE of the run, recorded as report execution history (report_runs)
  // — how many rows it covered, over what period, under which filters. Counts
  // and filter text only; never the exported rows themselves.
  //
  // NOT filterSummary verbatim, deliberately. That line ends with `Search:
  // <whatever was typed>`, and this page's search box matches victim, suspect
  // and complainant names — so storing it as written would put a person's name
  // into a table whose entire rule is that it holds scope and never personal
  // data. The run records THAT a search narrowed it, which is what a reader of
  // the history needs to know, and not who was searched for.
  const exportMeta = () => ({
    rowCount: sorted.length,
    periodFrom: filters['inc-dateFrom'] || null,
    periodTo: filters['inc-dateTo'] || null,
    filtersSummary: [
      `From: ${filters['inc-dateFrom'] || 'Any'}`,
      `To: ${filters['inc-dateTo'] || 'Any'}`,
      `Crime Type: ${filters['inc-crimeType'] || 'All'}`,
      `Category: ${filters['inc-category'] || 'All'}`,
      `Sitio: ${filters['inc-sitio'] || 'All'}`,
      `Status: ${filters['inc-status'] || 'All'}`,
      `Validation: ${filters['inc-validation'] || 'All'}`,
      `Search: ${debouncedSearch ? 'Applied' : 'None'}`,
    ].join(' · '),
  });

  // Wrapped in usePendingAction so the button can show that it is working and
  // refuses a second click while it is: exportWorkbook() pulls exceljs in on
  // first use, which is the one operation here slow enough to look broken.
  const [exporting, handleExportExcel] = usePendingAction(async () => {
    const ok = await exportWorkbook({
      filename: `incidents_${today()}.xlsx`,
      ...exportSpec(),
    });
    if (ok) {
      showToast('Incidents exported to Excel', 'success');
      // Recorded only on success, so the audit trail never claims an
      // export that did not happen. Not awaited: a completed download
      // must not wait on, or be failed by, follow-up bookkeeping.
      auditLogService.logExport('incidents', exportMeta());
    }
  });

  // Same projection, same `sorted` rows, comma-separated. Synchronous
  // because exportCsv needs no dynamic import — see the note there.
  const handleExportCsv = () => {
    const ok = exportCsv({
      filename: `incidents_${today()}.csv`,
      ...exportSpec(),
    });
    if (ok) {
      showToast('Incidents exported to CSV', 'success');
      // Same report key as the workbook above: the audit trail records WHICH
      // report left the system, which is the question it exists to answer.
      // AuditLogController::REPORTS is the server-side whitelist it must match.
      auditLogService.logExport('incidents', exportMeta());
    }
  };

  const handleCreate = async (data) => {
    try {
      await addRecord(data);
      setCreating(false);
      showToast('Incident recorded', 'success');
    } catch (err) {
      showToast(err.message || 'Could not save incident', 'error');
      // See handleSave: IncidentCreateModal needs the error to show the
      // server's field-level messages in the open form.
      throw err;
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
          `${sorted.length} record${sorted.length === 1 ? '' : 's'}`,
          filterSummary,
          sortSummary,
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
            {/* Checkpoint 27 — overall CSV export. Exports `sorted` (search +
                every active FilterBar field already applied above), matching
                this app's established export convention on every other module
                (Dashboard, Analytics, AuditLogs, Residents, CriminalRecords,
                VictimRecords all export their own filtered rows, not the raw
                unfiltered dataset) — there is no pagination on this table to
                worry about accidentally under-exporting from. This is
                deliberately separate from the per-incident "VIEW -> Export
                PDF" flow in IncidentModal, which exports only that one
                record. */}
            <Button
              variant="secondary"
              onClick={handleExportExcel}
              disabled={exporting}
              aria-busy={exporting}
            >
              {exporting ? (
                <>
                  <span className="spinner spinner-inline" aria-hidden="true" />{' '}
                  Exporting…
                </>
              ) : (
                <>
                  <Icons.Download size={15} strokeWidth={2} /> Export Excel
                </>
              )}
            </Button>
            <Button variant="secondary" onClick={handleExportCsv}>
              <Icons.Download size={15} strokeWidth={2} /> Export CSV
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              <Icons.Printer size={15} strokeWidth={2} /> Print Report
            </Button>
            {/* Record validation lives inside Crime Data Collection rather
                than in its own module, so the way in is a control on this
                page. Gated on the same 'validate_record' permission that
                already decides whether the review actions render at all — an
                Encoder does not hold it, so this button and its badge do not
                exist for them. The real control remains server-side
                (role:badac_admin,badac_validator on the validate/return
                routes); this only decides what is shown. */}
            {canValidate && (
              <Button
                variant="secondary"
                onClick={handleOpenValidation}
                aria-label={
                  unreadValidationCount > 0
                    ? `Validation, ${unreadValidationCount} new submissions`
                    : 'Validation'
                }
              >
                <Icons.ShieldCheck size={15} strokeWidth={2} /> Validation
                {unreadValidationCount > 0 && (
                  // Same unread badge the topbar bell uses, positioned
                  // statically inside the button exactly as the Trends
                  // "Mark All as Read" control does it.
                  <span
                    className="notif-bell-count"
                    style={{ position: 'static', marginLeft: 6 }}
                  >
                    {unreadValidationCount > 99 ? '99+' : unreadValidationCount}
                  </span>
                )}
              </Button>
            )}
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
            {
              id: 'inc-validation',
              label: 'Validation',
              type: 'select',
              options: Object.values(VALIDATION_STATUS_LABELS),
            },
            { id: 'inc-dateFrom', label: 'From', type: 'date' },
            { id: 'inc-dateTo', label: 'To', type: 'date' },
          ]}
          onApply={setFilters}
          initialValues={filterResetKey === 0 ? filters : {}}
          // The search box lives outside the bar, so clearing the filters has
          // to clear it too — otherwise "Clear Filters" would leave the list
          // still narrowed by a search term the user was told had been cleared.
          // The notification-arrival reset above is untouched and still uses
          // filterResetKey; this path does not remount the bar, so the two do
          // not interfere.
          onClear={() => setSearch('')}
        />

        {/* Validation queue summary. Shown to the Administrator, who acts on
            pending records, and to the Encoder, who acts on returned ones.
            role="status" so a change after a review is announced politely. */}
        {(canValidate || can('create_incident')) &&
          (validationCounts.pending > 0 || validationCounts.returned > 0) && (
            <div className="validation-summary print-hidden" role="status">
              <Icons.ShieldCheck size={16} strokeWidth={2} aria-hidden="true" />
              <span>
                <strong>{validationCounts.pending}</strong> pending validation
                {' · '}
                <strong>{validationCounts.returned}</strong> returned for
                correction
              </span>
              <span className="validation-summary-hint">
                {canValidate
                  ? 'Open a record and use Record Validation to review it.'
                  : 'Returned records show the reason when opened.'}
              </span>
            </div>
          )}

        {/* Print-only section heading, so the printed table is introduced
            rather than beginning abruptly under the document header. */}
        <h2 className="print-section-heading print-only">Incident Records</h2>

        <Card bodyClassName="table-wrap incident-report-table">
          <Table
            columns={[
              { key: 'caseNumber', label: 'Case #' },
              { key: 'crimeType', label: 'Type' },
              { key: 'category', label: 'Category' },
              // sortType 'date' so the column orders chronologically rather
              // than by the formatted text formatDate produces, which would
              // put every April before every January.
              {
                key: 'date',
                label: 'Date',
                render: formatDate,
                sortType: 'date',
              },
              { key: 'time', label: 'Time', render: formatTime },
              { key: 'sitio', label: 'Sitio' },
              { key: 'street', label: 'Location' },
              { key: 'reportingOfficer', label: 'Reporting Officer' },
              {
                key: 'status',
                label: 'Status',
                // Archiving overwrites status with 'Archived', so the row
                // alone no longer says whether this case was Open, Under
                // Investigation, Solved or Closed. previousStatus carries
                // that through — mirrors CriminalRecords.jsx/VictimRecords.jsx.
                render: (v, row) => (
                  <>
                    <Badge status={v} />
                    {v === 'Archived' && row.previousStatus ? (
                      <span
                        style={{
                          color: 'var(--text-muted)',
                          fontSize: '0.8rem',
                          marginLeft: 6,
                        }}
                      >
                        was {row.previousStatus}
                      </span>
                    ) : null}
                  </>
                ),
              },
              {
                key: 'validationStatus',
                label: 'Validation',
                render: (v) => <ValidationBadge status={v} />,
              },
            ]}
            rows={sorted}
            sort={sort}
            onSort={toggleSort}
            actions={(row) => (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setViewing(row)}
                  aria-label={
                    canValidate &&
                    row.validationStatus === 'pending' &&
                    row.status !== 'Archived'
                      ? `Review case ${row.caseNumber}`
                      : `View case ${row.caseNumber}`
                  }
                >
                  {canValidate &&
                  row.validationStatus === 'pending' &&
                  row.status !== 'Archived'
                    ? 'Review'
                    : 'View'}
                </Button>
                {canArchiveRecord(row) && row.status !== 'Archived' && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => handleArchive(row)}
                    disabled={archivingId === row.id}
                  >
                    {archivingId === row.id ? 'Archiving…' : 'Archive'}
                  </Button>
                )}
                {canArchiveRecord(row) && row.status === 'Archived' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleRestore(row)}
                    disabled={restoringId === row.id}
                  >
                    {restoringId === row.id ? 'Restoring…' : 'Restore'}
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
        onRestore={viewing && canArchiveRecord(viewing) ? handleRestore : null}
        restoring={viewing && restoringId === viewing.id}
        onApprove={canValidate ? handleApprove : null}
        onReturn={canValidate ? handleReturn : null}
        reviewing={Boolean(viewing && reviewingId === viewing.id)}
      />
      <IncidentEditModal
        incident={editing}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        onSave={handleSave}
        crimeTypes={CRIME_TYPES}
        categories={CATEGORIES}
        sitios={SITIOS}
        // ASSIGNABLE_STATUSES, not the STATUSES the Status filter above uses:
        // 'Archived' is set by the Archive action alone, so the form must not
        // offer it. The server rejects it too (Store/UpdateIncidentRequest).
        statuses={ASSIGNABLE_STATUSES}
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
        statuses={ASSIGNABLE_STATUSES}
        typeCategoryMap={TYPE_CATEGORY_MAP}
        validate={validateRecord}
      />
    </section>
  );
}
