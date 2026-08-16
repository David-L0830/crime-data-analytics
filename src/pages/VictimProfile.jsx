import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useData } from '../hooks/useData';
import { useToast } from '../hooks/useToast';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import PrintReport from '../components/ui/PrintReport';
import { formatDate, exportCSV, today } from '../utils/helpers';
import { Icons } from '../components/icons';

function computeAge(dob) {
  if (!dob) return null;
  const birth = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

// Same "Not available" convention as CriminalProfile.jsx's Field component —
// missing fields are shown, not invented or hidden.
function Field({ label, value }) {
  return (
    <div>
      <strong>{label}:</strong> {value === null || value === undefined || value === '' ? 'Not available' : value}
    </div>
  );
}

export default function VictimProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { victims } = useData();
  const { showToast } = useToast();

  const victim = useMemo(() => victims.find((v) => String(v.id) === String(id)), [victims, id]);

  if (!victim) {
    return (
      <section className="module">
        <div className="empty-state" style={{ padding: 60 }}>
          <p style={{ color: 'var(--text-muted)' }}>Victim record not found.</p>
          <Button variant="secondary" onClick={() => navigate('/criminal-records')}>
            <Icons.Back size={15} strokeWidth={2} /> Back to Records
          </Button>
        </div>
      </section>
    );
  }

  const age = computeAge(victim.dateOfBirth);

  return (
    <section className="module criminal-profile">
      <PrintReport title={`Victim Profile: ${victim.victimId}`} />

      <div className="module-toolbar export-bar" style={{ marginBottom: 20 }}>
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <Icons.Back size={15} strokeWidth={2} /> Back
        </Button>
        <div className="toolbar-actions">
          <Button
            variant="secondary"
            onClick={() => { if (exportCSV([victim], `victim_${victim.victimId}_${today()}.csv`, () => showToast('Could not export profile.', 'error'))) showToast('Profile exported', 'success'); }}
          >
            <Icons.Download size={15} strokeWidth={2} /> Export Profile
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            <Icons.Printer size={15} strokeWidth={2} /> Print Profile
          </Button>
        </div>
      </div>

      <Card>
        <div className="profile-header">
          <div className="profile-photo">
            <div className="profile-photo-placeholder">
              <Icons.Photo size={28} strokeWidth={1.5} />
              <span>NO PHOTO</span>
            </div>
          </div>
          <div className="profile-header-info">
            <h2>{victim.fullName}</h2>
            {victim.alias && <p className="profile-alias">Alias: {victim.alias}</p>}
            <p className="profile-id"><Icons.IdCard size={14} strokeWidth={2} /> Victim ID: {victim.victimId}</p>
            <Badge status={victim.status || 'Active'} />
          </div>
        </div>
      </Card>

      <div className="profile-grid">
        <Card title="Personal Information">
          <div className="detail-grid">
            <Field label="Full Name" value={victim.fullName} />
            <Field label="Alias / Known As" value={victim.alias} />
            <Field label="Gender" value={victim.gender} />
            <Field label="Date of Birth" value={victim.dateOfBirth ? formatDate(victim.dateOfBirth) : null} />
            <Field label="Age" value={age} />
            <Field label="Civil Status" value={victim.civilStatus} />
            <Field label="Nationality" value={victim.nationality} />
            <Field label="Contact Information" value={victim.contactNumber} />
            <div className="full"><Field label="Address" value={victim.address} /></div>
          </div>
        </Card>

        <Card title="Related Cases" bodyClassName="table-wrap">
          {victim.relatedCases && victim.relatedCases.length > 0 ? (
            <Table
              columns={[
                { key: 'caseNumber', label: 'Case Number' },
                { key: 'charge', label: 'Charge' },
                { key: 'status', label: 'Case Status', render: (v) => <Badge status={v} /> },
                {
                  key: 'relatedCriminals',
                  label: 'Related Criminal',
                  render: (v) => (v && v.length ? v.map((c) => c.fullName).join(', ') : '—'),
                },
              ]}
              rows={victim.relatedCases}
              actions={(row) => {
                const suspect = row.relatedCriminals && row.relatedCriminals[0];
                return suspect ? (
                  <Button size="sm" variant="secondary" onClick={() => navigate(`/criminal-records/${suspect.id}`)}>
                    View Case
                  </Button>
                ) : null;
              }}
            />
          ) : (
            <p style={{ color: 'var(--text-muted)', padding: '12px 4px' }}>This victim is not linked to any case yet.</p>
          )}
        </Card>
      </div>
    </section>
  );
}
