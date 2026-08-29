import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../hooks/useData';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { useDebounce } from '../hooks/useDebounce';
import FilterBar from '../components/ui/FilterBar';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { today } from '../utils/helpers';
import { exportWorkbook } from '../utils/exportWorkbook';
import { auditLogService } from '../services/auditLogService';
import { CRIMINAL_STATUSES } from '../utils/constants';
import { Icons } from '../components/icons';

export default function CriminalRecords() {
  const { criminals, archiveCriminal, restoreCriminal } = useData();
  const { can } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({});
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [archivingId, setArchivingId] = useState(null);
  const [restoringId, setRestoringId] = useState(null);

  // Search covers Full Name, Alias, Criminal ID, and Case Number (Part I-49).
  // Duplicate full names are never merged — each row keeps its own
  // Criminal ID/DOB/Sitio so visually-identical names stay distinguishable
  // in the results list (Part I-50).
  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return criminals.filter((c) => {
      if (filters['crim-status'] && c.status !== filters['crim-status'])
        return false;
      // Default operational list shows active criminal records; Archived
      // criminals remain stored and retrievable by explicitly selecting
      // "Archived" in the Status filter above. Mirrors VictimRecords.jsx.
      if (!filters['crim-status'] && c.status === 'Archived') return false;
      if (filters['crim-gender'] && c.gender !== filters['crim-gender'])
        return false;
      if (q) {
        const caseNumbers = (c.relatedIncidents || [])
          .map((i) => i.caseNumber)
          .join(' ');
        const hay =
          `${c.criminalId} ${c.fullName} ${c.alias || ''} ${c.relatedCaseNumber || ''} ${caseNumbers} ${(c.charges || []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [criminals, filters, debouncedSearch]);

  // Real .xlsx through the same shared exportWorkbook helper the Dashboard,
  // Statistical Analysis and Crime Data Collection reports use, so every
  // export in the system is formatted by one implementation rather than each
  // module growing its own.
  //
  // This replaces a raw CSV of the API objects. That export was driven by the
  // keys of the first row, so it carried the internal database id, photoUrl
  // and relatedIncidentId, and — because relatedIncidents and caseHistory are
  // arrays of objects — two columns of JSON that no spreadsheet can read. The
  // columns below are an explicit, ordered projection of the same `filtered`
  // records the list is showing: related cases become a readable comma list,
  // and previousStatus stays out because it is restore plumbing rather than
  // reportable data. No record value is altered.
  const handleExportExcel = async () => {
    const ok = await exportWorkbook({
      filename: `criminal_records_${today()}.xlsx`,
      sheetName: 'Criminal Records',
      title: 'Criminal Records Report',
      subtitle: 'Crime Data Analytics & Reporting System',
      meta: [
        `Status: ${filters['crim-status'] || 'All'}`,
        `Gender: ${filters['crim-gender'] || 'All'}`,
        `Search: ${debouncedSearch || 'None'}`,
      ],
      columns: [
        { header: 'Criminal ID', key: 'criminalId', width: 14 },
        { header: 'Full Name', key: 'fullName', width: 26 },
        { header: 'Alias', key: 'alias', width: 18 },
        { header: 'Gender', key: 'gender', width: 10, align: 'center' },
        { header: 'Date of Birth', key: 'dateOfBirth', type: 'date', width: 14 },
        { header: 'Civil Status', key: 'civilStatus', width: 14 },
        { header: 'Nationality', key: 'nationality', width: 14 },
        { header: 'Contact Number', key: 'contactNumber', width: 16 },
        { header: 'Sitio', key: 'sitio', width: 14 },
        { header: 'Address', key: 'address', width: 32, wrap: true },
        { header: 'Status', key: 'status', width: 14, align: 'center' },
        {
          header: 'Charges',
          key: 'charges',
          width: 28,
          wrap: true,
          value: (r) => (r.charges || []).join(', '),
        },
        {
          header: 'Related Cases',
          key: 'relatedCases',
          width: 28,
          wrap: true,
          value: (r) =>
            (r.relatedIncidents || []).map((i) => i.caseNumber).join(', '),
        },
        { header: 'Notes', key: 'notes', width: 40, wrap: true },
      ],
      rows: filtered,
      onEmpty: () => showToast('No data to export', 'error'),
      onError: () => showToast('Could not export report.', 'error'),
    });
    if (ok) {
      showToast('Criminal records exported to Excel', 'success');
      // Recorded only on success, so the audit trail never claims an
      // export that did not happen. Not awaited: a completed download
      // must not wait on, or be failed by, follow-up bookkeeping.
      auditLogService.logExport('criminal-records');
    }
  };

  // Mirrors VictimRecords.jsx's handleArchive. PUT /criminals/{id}/archive
  // is badac_admin-only server-side (routes/api.php); this UI-side guard
  // (can('archive_record')) is added in the next step alongside the button.
  const handleArchive = async (criminal) => {
    if (archivingId) return;
    if (
      !window.confirm(
        `Archive the criminal record for ${criminal.fullName}? It will be removed from the active list but kept on file and can still be found via the Status filter.`,
      )
    ) {
      return;
    }
    setArchivingId(criminal.id);
    try {
      await archiveCriminal(criminal.id);
      showToast('Criminal record archived', 'success');
    } catch (err) {
      showToast(err.message || 'Could not archive criminal record', 'error');
    } finally {
      setArchivingId(null);
    }
  };

  // Inverse of handleArchive. PUT /criminals/{id}/restore is badac_admin-only
  // server-side (routes/api.php, same group as archive); the can()
  // check on the button below deliberately reuses 'archive_record' rather
  // than a new permission, so whoever may archive may restore.
  //
  // The confirmation names the exact status the record will return to. The
  // server is still the authority — it reads previous_status from the row —
  // but showing it here means the admin is never confirming blind. The
  // 'Active' fallback in the wording matches the server's own fallback when
  // previous_status is null.
  const handleRestore = async (criminal) => {
    if (restoringId) return;
    const target = criminal.previousStatus || 'Active';
    if (
      !window.confirm(
        `Restore the criminal record for ${criminal.fullName}? Its status will be set back to ${target} and it will reappear in the active list.`,
      )
    ) {
      return;
    }
    setRestoringId(criminal.id);
    try {
      await restoreCriminal(criminal.id);
      showToast(`Criminal record restored to ${target}`, 'success');
    } catch (err) {
      showToast(err.message || 'Could not restore criminal record', 'error');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <section className="module">
      <div className="module-toolbar">
        <div className="search-box">
          <input
            type="text"
            placeholder="Search full name, alias, criminal ID, case number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="toolbar-actions">
          <Button variant="secondary" onClick={handleExportExcel}>
            <Icons.Download size={15} strokeWidth={2} /> Export Excel
          </Button>
        </div>
      </div>

      <FilterBar
        fields={[
          {
            id: 'crim-status',
            label: 'Status',
            type: 'select',
            options: CRIMINAL_STATUSES,
          },
          {
            id: 'crim-gender',
            label: 'Gender',
            type: 'select',
            options: ['Male', 'Female'],
          },
        ]}
        onApply={setFilters}
      />

      <Card bodyClassName="table-wrap">
        <Table
          columns={[
            { key: 'criminalId', label: 'Criminal ID' },
            { key: 'fullName', label: 'Full Name' },
            { key: 'alias', label: 'Alias', render: (v) => v || '—' },
            { key: 'gender', label: 'Gender' },
            {
              key: 'charges',
              label: 'Charges',
              render: (v) => (v || []).join(', ') || '—',
            },
            {
              key: 'relatedCaseNumber',
              label: 'Case',
              render: (v) => v || '—',
            },
            {
              key: 'status',
              label: 'Status',
              // Archiving overwrites status with 'Archived', so the row alone
              // no longer says whether this person was Wanted, Incarcerated,
              // Released or Deceased. previousStatus carries that through, and
              // showing it here is what keeps a meaningful status from simply
              // disappearing on archive. Non-archived rows render exactly as
              // before — a plain Badge, matching Table's own default.
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
          ]}
          rows={filtered}
          actions={(row) => (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigate(`/criminal-records/${row.id}`)}
              >
                View Profile
              </Button>
              {can('archive_record') && row.status !== 'Archived' && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => handleArchive(row)}
                  disabled={archivingId === row.id}
                >
                  {archivingId === row.id ? 'Archiving…' : 'Archive'}
                </Button>
              )}
              {can('archive_record') && row.status === 'Archived' && (
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
    </section>
  );
}
