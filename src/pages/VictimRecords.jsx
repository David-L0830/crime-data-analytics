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
  const { victims, archiveVictim } = useData();
  const { can } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({});
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [archivingId, setArchivingId] = useState(null);

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return victims.filter((v) => {
      if (filters['victim-gender'] && v.gender !== filters['victim-gender']) return false;
      if (filters['victim-status'] && v.status !== filters['victim-status']) return false;
      // Checkpoint 20, Task 14 — default operational list shows active
      // victim records; Archived victims remain stored and retrievable by
      // explicitly selecting "Archived" in the Status filter above.
      if (!filters['victim-status'] && v.status === 'Archived') return false;
      if (q) {
        const caseNumbers = (v.relatedCases || []).map((c) => c.caseNumber).join(' ');
        const hay = `${v.victimId} ${v.fullName} ${v.alias || ''} ${caseNumbers}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [victims, filters, debouncedSearch]);

  // Checkpoint 20, Tasks 8/9 — Victim records had no delete/archive UI at
  // all before this checkpoint. Reuses archive_record, same reasoning as
  // Residents.jsx: PUT /victims/{id}/archive is badac_admin-only
  // server-side (routes/api.php) with no per-record ownership dimension,
  // and Encoder never had a criminal-records route at all.
  const handleArchive = async (victim) => {
    if (archivingId) return;
    if (!window.confirm(`Archive the victim record for ${victim.fullName}? It will be removed from the active list but kept on file and can still be found via the Status filter.`)) {
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
            onClick={() => { if (exportCSV(filtered, `victim_records_${today()}.csv`, () => showToast('No data to export', 'error'))) showToast('Victim records exported', 'success'); }}
          >
            <Icons.Download size={15} strokeWidth={2} /> Export CSV
          </Button>
        </div>
      </div>

      <FilterBar
        fields={[
          { id: 'victim-gender', label: 'Gender', type: 'select', options: ['Male', 'Female'] },
          { id: 'victim-status', label: 'Status', type: 'select', options: VICTIM_STATUSES },
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
            { key: 'status', label: 'Status', render: (v) => <Badge status={v || 'Active'} /> },
            { key: 'relatedCases', label: 'Cases', render: (v) => (v || []).map((c) => c.caseNumber).join(', ') || '—' },
          ]}
          rows={filtered}
          actions={(row) => (
            <>
              <Button size="sm" variant="secondary" onClick={() => navigate(`/criminal-records/victims/${row.id}`)}>
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
            </>
          )}
        />
      </Card>
    </section>
  );
}
