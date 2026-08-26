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
import { exportCSV, today } from '../utils/helpers';
import { VICTIM_STATUSES } from '../utils/constants';
import { Icons } from '../components/icons';

// Victim Record list (Checkpoint 19, Task 2). Mirrors the structure of
// pages/CriminalRecords.jsx — same data-fetching pattern (useData), same
// filter/search/export conventions — but reads the existing `victims`
// collection and routes into the existing VictimProfile page
// (/criminal-records/victims/:id), so no business logic is duplicated.
export default function VictimRecords() {
  const { victims, archiveVictim, restoreVictim } = useData();
  const { can } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({});
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [archivingId, setArchivingId] = useState(null);
  const [restoringId, setRestoringId] = useState(null);

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return victims.filter((v) => {
      if (filters['victim-gender'] && v.gender !== filters['victim-gender'])
        return false;
      if (filters['victim-status'] && v.status !== filters['victim-status'])
        return false;
      // Checkpoint 20, Task 14 — default operational list shows active
      // victim records; Archived victims remain stored and retrievable by
      // explicitly selecting "Archived" in the Status filter above.
      if (!filters['victim-status'] && v.status === 'Archived') return false;
      if (q) {
        const caseNumbers = (v.relatedCases || [])
          .map((c) => c.caseNumber)
          .join(' ');
        const hay =
          `${v.victimId} ${v.fullName} ${v.alias || ''} ${caseNumbers}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [victims, filters, debouncedSearch]);

  // previousStatus is an internal restore field: it drives the archived-row
  // "was X" hint in the table below and the Restore confirmation, but it is
  // not part of the record's reportable data and must not become a CSV
  // column. exportCSV derives its header from the keys of the first row, so
  // the field is stripped here rather than inside the helper — that helper is
  // shared by every other export in the app (incidents, audit logs, analytics)
  // and is deliberately left untouched.
  const exportRows = useMemo(
    () =>
      filtered.map((row) => {
        const { previousStatus: _previousStatus, ...rest } = row;
        return rest;
      }),
    [filtered],
  );

  // Checkpoint 20, Tasks 8/9 — Victim records had no delete/archive UI at
  // all before this checkpoint. Reuses archive_record, same reasoning as
  // Residents.jsx: PUT /victims/{id}/archive is badac_admin-only
  // server-side (routes/api.php) with no per-record ownership dimension,
  // and Encoder never had a criminal-records route at all.
  const handleArchive = async (victim) => {
    if (archivingId) return;
    if (
      !window.confirm(
        `Archive the victim record for ${victim.fullName}? It will be removed from the active list but kept on file and can still be found via the Status filter.`,
      )
    ) {
      return;
    }
    setArchivingId(victim.id);
    try {
      await archiveVictim(victim.id);
      showToast('Victim record archived', 'success');
    } catch (err) {
      showToast(err.message || 'Could not archive victim record', 'error');
    } finally {
      setArchivingId(null);
    }
  };

  // Mirrors CriminalRecords.jsx's handleRestore, including the reuse of the
  // existing 'archive_record' permission rather than a restore-specific one:
  // PUT /victims/{id}/restore sits in the same badac_admin-only route group
  // as the archive endpoint.
  const handleRestore = async (victim) => {
    if (restoringId) return;
    const target = victim.previousStatus || 'Active';
    if (
      !window.confirm(
        `Restore the victim record for ${victim.fullName}? Its status will be set back to ${target} and it will reappear in the active list.`,
      )
    ) {
      return;
    }
    setRestoringId(victim.id);
    try {
      await restoreVictim(victim.id);
      showToast(`Victim record restored to ${target}`, 'success');
    } catch (err) {
      showToast(err.message || 'Could not restore victim record', 'error');
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
            placeholder="Search full name, alias, victim ID, case number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="toolbar-actions">
          <Button
            variant="secondary"
            onClick={() => {
              if (
                exportCSV(exportRows, `victim_records_${today()}.csv`, () =>
                  showToast('No data to export', 'error'),
                )
              )
                showToast('Victim records exported', 'success');
            }}
          >
            <Icons.Download size={15} strokeWidth={2} /> Export CSV
          </Button>
        </div>
      </div>

      <FilterBar
        fields={[
          {
            id: 'victim-gender',
            label: 'Gender',
            type: 'select',
            options: ['Male', 'Female'],
          },
          {
            id: 'victim-status',
            label: 'Status',
            type: 'select',
            options: VICTIM_STATUSES,
          },
        ]}
        onApply={setFilters}
      />

      <Card bodyClassName="table-wrap">
        <Table
          columns={[
            { key: 'victimId', label: 'Victim ID' },
            { key: 'fullName', label: 'Full Name' },
            { key: 'alias', label: 'Alias', render: (v) => v || '—' },
            { key: 'gender', label: 'Gender' },
            { key: 'contactNumber', label: 'Contact', render: (v) => v || '—' },
            {
              key: 'status',
              label: 'Status',
              // Same treatment as CriminalRecords.jsx — an archived row also
              // shows what it will be restored to.
              render: (v, row) => (
                <>
                  <Badge status={v || 'Active'} />
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
              key: 'relatedCases',
              label: 'Cases',
              render: (v) =>
                (v || []).map((c) => c.caseNumber).join(', ') || '—',
            },
          ]}
          rows={filtered}
          actions={(row) => (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigate(`/criminal-records/victims/${row.id}`)}
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
