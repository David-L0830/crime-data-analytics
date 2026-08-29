import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useData } from '../hooks/useData';
import { useToast } from '../hooks/useToast';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import PrintReport, {
  PrintSignatures,
  PrintDocumentEnd,
} from '../components/ui/PrintReport';
import { formatDate, today } from '../utils/helpers';
import { exportWorkbook } from '../utils/exportWorkbook';
import { auditLogService } from '../services/auditLogService';
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
      <strong>{label}:</strong>{' '}
      {value === null || value === undefined || value === ''
        ? 'Not available'
        : value}
    </div>
  );
}

export default function VictimProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { victims } = useData();
  const { showToast } = useToast();

  const victim = useMemo(
    () => victims.find((v) => String(v.id) === String(id)),
    [victims, id],
  );

  if (!victim) {
    return (
      <section className="module">
        <div className="empty-state" style={{ padding: 60 }}>
          <p style={{ color: 'var(--text-muted)' }}>Victim record not found.</p>
          <Button
            variant="secondary"
            onClick={() => navigate('/criminal-records')}
          >
            <Icons.Back size={15} strokeWidth={2} /> Back to Records
          </Button>
        </div>
      </section>
    );
  }

  const age = computeAge(victim.dateOfBirth);

  // Same shared exportWorkbook helper and same two-column Field / Value sheet
  // as Criminal Profile, so both record exports are one implementation. See
  // the note there on what the previous raw-object CSV contained.
  const handleExportProfile = async () => {
    const rows = [
      ['Victim ID', victim.victimId],
      ['Full Name', victim.fullName],
      ['Alias / Known As', victim.alias],
      ['Gender', victim.gender],
      ['Date of Birth', victim.dateOfBirth ? formatDate(victim.dateOfBirth) : ''],
      ['Age', age],
      ['Civil Status', victim.civilStatus],
      ['Nationality', victim.nationality],
      ['Contact Number', victim.contactNumber],
      ['Address', victim.address],
      ['Status', victim.status || 'Active'],
      [
        'Related Cases',
        (victim.relatedCases || [])
          .map((c) => `${c.caseNumber} (${c.charge}, ${c.status})`)
          .join('; '),
      ],
      [
        'Related Criminals',
        [
          ...new Set(
            (victim.relatedCases || []).flatMap((c) =>
              (c.relatedCriminals || []).map((x) => x.fullName),
            ),
          ),
        ].join(', '),
      ],
    ].map(([field, value]) => ({
      field,
      value: value === null || value === undefined || value === '' ? 'Not available' : value,
    }));

    const ok = await exportWorkbook({
      filename: `victim_${victim.victimId}_${today()}.xlsx`,
      sheetName: 'Victim Profile',
      title: `Victim Profile \u2014 ${victim.victimId}`,
      subtitle: victim.fullName,
      columns: [
        { header: 'Field', key: 'field', width: 26 },
        { header: 'Value', key: 'value', width: 70, wrap: true },
      ],
      rows,
      onEmpty: () => showToast('Could not export profile.', 'error'),
      onError: () => showToast('Could not export profile.', 'error'),
    });
    if (ok) {
      showToast('Profile exported to Excel', 'success');
      // Recorded only on success, so the audit trail never claims an
      // export that did not happen. Not awaited: a completed download
      // must not wait on, or be failed by, follow-up bookkeeping.
      auditLogService.logExport('victim-profile');
    }
  };

  return (
    <section className="module criminal-profile print-root">
      {/* Same shared print document as Criminal Profile - identical header,
          typography, page numbering and signature block, differing only in
          what the record is about. The .criminal-profile class is the shared
          print wrapper both pages use; it is not criminal-specific. */}
      <PrintReport
        title={`Victim Profile \u2014 ${victim.victimId}`}
        subtitle={victim.fullName}
        meta={[
          `Victim ID: ${victim.victimId}`,
          `Status: ${victim.status || 'Active'}`,
        ]}
      >

        <div className="module-toolbar export-bar" style={{ marginBottom: 20 }}>
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <Icons.Back size={15} strokeWidth={2} /> Back
          </Button>
          <div className="toolbar-actions">
            <Button variant="secondary" onClick={handleExportProfile}>
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
              {victim.alias && (
                <p className="profile-alias">Alias: {victim.alias}</p>
              )}
              <p className="profile-id">
                <Icons.IdCard size={14} strokeWidth={2} /> Victim ID:{' '}
                {victim.victimId}
              </p>
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
              <Field
                label="Date of Birth"
                value={victim.dateOfBirth ? formatDate(victim.dateOfBirth) : null}
              />
              <Field label="Age" value={age} />
              <Field label="Civil Status" value={victim.civilStatus} />
              <Field label="Nationality" value={victim.nationality} />
              <Field label="Contact Information" value={victim.contactNumber} />
              <div className="full">
                <Field label="Address" value={victim.address} />
              </div>
            </div>
          </Card>

          <Card title="Related Cases" bodyClassName="table-wrap">
            {victim.relatedCases && victim.relatedCases.length > 0 ? (
              <Table
                columns={[
                  { key: 'caseNumber', label: 'Case Number' },
                  { key: 'charge', label: 'Charge' },
                  {
                    key: 'status',
                    label: 'Case Status',
                    render: (v) => <Badge status={v} />,
                  },
                  {
                    key: 'relatedCriminals',
                    label: 'Related Criminal',
                    render: (v) =>
                      v && v.length ? v.map((c) => c.fullName).join(', ') : '—',
                  },
                ]}
                rows={victim.relatedCases}
                actions={(row) => {
                  const suspect = row.relatedCriminals && row.relatedCriminals[0];
                  return suspect ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="print-hidden"
                      onClick={() => navigate(`/criminal-records/${suspect.id}`)}
                    >
                      View Case
                    </Button>
                  ) : null;
                }}
              />
            ) : (
              <p style={{ color: 'var(--text-muted)', padding: '12px 4px' }}>
                This victim is not linked to any case yet.
              </p>
            )}
          </Card>
        </div>

        <PrintDocumentEnd />

        {/* Same reusable signature block as Criminal Profile - see the note
            there on why the names are left to be written in by hand. */}
        <PrintSignatures
          signatories={[
            {
              role: 'Prepared by:',
              title: 'BADAC Encoder / Records Officer',
            },
            {
              role: 'Noted by:',
              title: 'Punong Barangay',
            },
          ]}
        />
      </PrintReport>
    </section>
  );
}
