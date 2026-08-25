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
import {
  IncidentViewModal,
  IncidentEditModal,
  IncidentCreateModal,
} from '../components/incidents/IncidentModal';
import {
  filterRecords,
  formatDate,
  formatTime,
  exportCSV,
  today,
  SOLVED_STATUSES,
  PENDING_STATUSES,
} from '../utils/helpers';
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
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [archivingId, setArchivingId] = useState(null);

  // Arriving from a notification click (e.g. "Case Resolved" / "Overdue
  // Case") carries the referenced case number in router state — pre-fill
  // the search box with it so the record is immediately visible.
  useEffect(() => {
    if (location.state?.search) setSearch(location.state.search);
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

  // Only BADAC Administrator may archive incidents. Encoder no longer has
  // 'archive_own_incident' in PERMISSIONS (constants.js), so this always
  // evaluates false for Encoder — matching PUT /incidents/{incident}/archive
  // now being role:badac_admin-only on the backend (routes/api.php).
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
    <section className="module">
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
          <Button
            variant="secondary"
            onClick={() => {
              if (
                exportCSV(filtered, `incidents_${today()}.csv`, () =>
                  showToast('No data to export', 'error'),
                )
              ) {
                showToast('Incidents exported', 'success');
              }
            }}
          >
            <Icons.Download size={15} strokeWidth={2} /> Export CSV
          </Button>
          {can('create_incident') && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icons.ClipboardList size={15} strokeWidth={2} /> New Incident
            </Button>
          )}
        </div>
      </div>

      <FilterBar
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
        initialValues={filters}
      />

      <Card bodyClassName="table-wrap">
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
