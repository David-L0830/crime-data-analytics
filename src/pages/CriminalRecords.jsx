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
import { exportCSV, today } from '../utils/helpers';
import { CRIMINAL_STATUSES } from '../utils/constants';
import { Icons } from '../components/icons';

export default function CriminalRecords() {
  const { criminals, archiveCriminal } = useData();
  const { can } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({});
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [archivingId, setArchivingId] = useState(null);

  // Search covers Full Name, Alias, Criminal ID, and Case Number (Part I-49).
  // Duplicate full names are never merged — each row keeps its own
  // Criminal ID/DOB/Sitio so visually-identical names stay distinguishable
  // in the results list (Part I-50).
  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return criminals.filter((c) => {
      if (filters['crim-status'] && c.status !== filters['crim-status']) return false;
      // Default operational list shows active criminal records; Archived
      // criminals remain stored and retrievable by explicitly selecting
      // "Archived" in the Status filter above. Mirrors VictimRecords.jsx.
      if (!filters['crim-status'] && c.status === 'Archived') return false;
      if (filters['crim-gender'] && c.gender !== filters['crim-gender']) return false;
      if (q) {
        const caseNumbers = (c.relatedIncidents || []).map((i) => i.caseNumber).join(' ');
        const hay = `${c.criminalId} ${c.fullName} ${c.alias || ''} ${c.relatedCaseNumber || ''} ${caseNumbers} ${(c.charges || []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [criminals, filters, debouncedSearch]);

  // Mirrors VictimRecords.jsx's handleArchive. PUT /criminals/{id}/archive
  // is badac_admin-only server-side (routes/api.php); this UI-side guard
  // (can('archive_record')) is added in the next step alongside the button.
  const handleArchive = async (criminal) => {
    if (archivingId) return;
    if (!window.confirm(`Archive the criminal record for ${criminal.fullName}? It will be removed from the active list but kept on file and can still be found via the Status filter.`)) {
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
          <Button
            variant="secondary"
            onClick={() => { if (exportCSV(filtered, `criminal_records_${today()}.csv`, () => showToast('No data to export', 'error'))) showToast('Criminal records exported', 'success'); }}
          >
            <Icons.Download size={15} strokeWidth={2} /> Export CSV
          </Button>
        </div>
      </div>

      <FilterBar
        fields={[
          { id: 'crim-status', label: 'Status', type: 'select', options: CRIMINAL_STATUSES },
          { id: 'crim-gender', label: 'Gender', type: 'select', options: ['Male', 'Female'] },
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
            { key: 'charges', label: 'Charges', render: (v) => (v || []).join(', ') || '—' },
            { key: 'relatedCaseNumber', label: 'Case', render: (v) => v || '—' },
            { key: 'status', label: 'Status' },
          ]}
          rows={filtered}
          actions={(row) => (
            <>
              <Button size="sm" variant="secondary" onClick={() => navigate(`/criminal-records/${row.id}`)}>
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
