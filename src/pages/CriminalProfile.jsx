import { useEffect, useMemo, useState } from 'react';
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

// Field rows only render when the underlying data exists — per Part I-53,
// missing fields show "Not available" rather than being invented, and
// fields the record simply doesn't track are omitted rather than faked.
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

export default function CriminalProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { criminals } = useData();
  const { showToast } = useToast();
  const [photoError, setPhotoError] = useState(false);

  const criminal = useMemo(
    () => criminals.find((c) => String(c.id) === String(id)),
    [criminals, id],
  );

  useEffect(() => {
    setPhotoError(false);
  }, [id]);

  if (!criminal) {
    return (
      <section className="module">
        <div className="empty-state" style={{ padding: 60 }}>
          <p style={{ color: 'var(--text-muted)' }}>
            Criminal record not found.
          </p>
          <Button
            variant="secondary"
            onClick={() => navigate('/criminal-records/criminal')}
          >
            <Icons.Back size={15} strokeWidth={2} /> Back to Criminal Records
          </Button>
        </div>
      </section>
    );
  }

  const age = computeAge(criminal.dateOfBirth);
  const statusForHeader = criminal.status || 'Unknown';
  const StatusIcon =
    statusForHeader === 'Wanted'
      ? Icons.Wanted
      : ['Released', 'Deceased'].includes(statusForHeader)
        ? Icons.Cleared
        : Icons.ShieldCheck || Icons.Cleared;

  const physicalFields = [
    ['Height', criminal.height],
    ['Weight', criminal.weight],
    ['Build', criminal.build],
    ['Hair Color', criminal.hairColor],
    ['Eye Color', criminal.eyeColor],
    ['Distinguishing Marks', criminal.distinguishingMarks],
  ].filter(([, v]) => v);

  return (
    <section className="module criminal-profile">
      <PrintReport title={`Criminal Profile: ${criminal.criminalId}`} />

      <div className="module-toolbar export-bar" style={{ marginBottom: 20 }}>
        <Button
          variant="ghost"
          onClick={() => navigate('/criminal-records/criminal')}
        >
          <Icons.Back size={15} strokeWidth={2} /> Back
        </Button>
        <div className="toolbar-actions">
          <Button
            variant="secondary"
            onClick={() => {
              if (
                exportCSV(
                  [criminal],
                  `criminal_${criminal.criminalId}_${today()}.csv`,
                  () => showToast('Could not export profile.', 'error'),
                )
              )
                showToast('Profile exported', 'success');
            }}
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
            {criminal.photoUrl && !photoError ? (
              <img
                src={criminal.photoUrl}
                alt=""
                onError={() => setPhotoError(true)}
              />
            ) : (
              <div className="profile-photo-placeholder">
                <Icons.Photo size={28} strokeWidth={1.5} />
                <span>NO PHOTO</span>
              </div>
            )}
          </div>
          <div className="profile-header-info">
            <h2>{criminal.fullName}</h2>
            {criminal.alias && (
              <p className="profile-alias">Alias: {criminal.alias}</p>
            )}
            <p className="profile-id">
              <Icons.IdCard size={14} strokeWidth={2} /> Criminal ID:{' '}
              {criminal.criminalId}
            </p>
            <div className="profile-status">
              <StatusIcon size={15} strokeWidth={2} />
              <Badge status={criminal.status} />
            </div>
          </div>
        </div>
      </Card>

      <div className="profile-grid">
        <Card title="Personal Information">
          <div className="detail-grid">
            <Field label="Full Name" value={criminal.fullName} />
            <Field label="Alias / Known As" value={criminal.alias} />
            <Field label="Gender" value={criminal.gender} />
            <Field
              label="Date of Birth"
              value={
                criminal.dateOfBirth ? formatDate(criminal.dateOfBirth) : null
              }
            />
            <Field label="Age" value={age} />
            <Field label="Civil Status" value={criminal.civilStatus} />
            <Field label="Nationality" value={criminal.nationality} />
            <Field label="Contact Information" value={criminal.contactNumber} />
            <Field label="Sitio" value={criminal.sitio} />
            <div className="full">
              <Field label="Address" value={criminal.address} />
            </div>
          </div>
        </Card>

        {physicalFields.length > 0 && (
          <Card title="Physical Description">
            <div className="detail-grid">
              {physicalFields.map(([label, value]) => (
                <Field key={label} label={label} value={value} />
              ))}
              {criminal.physicalDescription && (
                <div className="full">
                  <Field
                    label="Additional Notes"
                    value={criminal.physicalDescription}
                  />
                </div>
              )}
            </div>
          </Card>
        )}

        <Card title="Criminal / Case Information">
          <div className="detail-grid">
            <Field label="Current Status" value={criminal.status} />
            <Field label="Case Number" value={criminal.relatedCaseNumber} />
            <div className="full">
              <Field
                label="Charges"
                value={(criminal.charges || []).join(', ') || null}
              />
            </div>
          </div>
        </Card>

        <Card title="Victim Information" className="victim-info-card">
          {criminal.relatedIncidents && criminal.relatedIncidents.length > 0 ? (
            <div className="case-victim-list">
              {criminal.relatedIncidents.map((incident) => (
                <div className="case-victim-group" key={incident.id}>
                  <div className="case-victim-group-header">
                    <div>
                      <span className="case-victim-case-number">
                        {incident.caseNumber}
                      </span>
                      <span className="case-victim-charge">
                        {incident.crimeType}
                      </span>
                    </div>
                    <Badge status={incident.status} />
                  </div>
                  {incident.victims && incident.victims.length > 0 ? (
                    <ul className="case-victim-items">
                      {incident.victims.map((victim) => (
                        <li key={victim.id} className="case-victim-item">
                          <div>
                            <div className="case-victim-name">
                              {victim.fullName}
                            </div>
                            <div className="case-victim-id">
                              Victim ID: {victim.victimId}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="print-hidden"
                            onClick={() =>
                              navigate(`/criminal-records/victims/${victim.id}`)
                            }
                          >
                            View Victim Profile
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="case-victim-empty">
                      No victims recorded for this case.
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', padding: '12px 4px' }}>
              No cases on record for this criminal, so no victim information is
              available.
            </p>
          )}
        </Card>

        <Card title="Related Incidents" bodyClassName="table-wrap">
          {criminal.relatedIncidents && criminal.relatedIncidents.length > 0 ? (
            <Table
              columns={[
                { key: 'caseNumber', label: 'Case Number' },
                { key: 'crimeType', label: 'Crime Type' },
                {
                  key: 'date',
                  label: 'Date',
                  render: (v) => (v ? formatDate(v) : '—'),
                },
                { key: 'location', label: 'Location' },
                { key: 'sitio', label: 'Sitio' },
                { key: 'status', label: 'Status' },
              ]}
              rows={criminal.relatedIncidents}
            />
          ) : (
            <p style={{ color: 'var(--text-muted)', padding: '12px 4px' }}>
              No related incidents found.
            </p>
          )}
        </Card>

        <Card title="Case History">
          {criminal.caseHistory && criminal.caseHistory.length > 0 ? (
            <div className="case-history">
              {criminal.caseHistory.map((event, i) => (
                <div className="case-history-item" key={i}>
                  <div className="case-history-date">
                    {event.date
                      ? new Date(event.date).toLocaleDateString('en-PH')
                      : '—'}
                  </div>
                  <div>
                    <div className="case-history-label">{event.label}</div>
                    <div className="case-history-detail">{event.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', padding: '12px 4px' }}>
              No case history available.
            </p>
          )}
        </Card>

        <Card title="Notes & Remarks">
          <p style={{ whiteSpace: 'pre-wrap' }}>
            {criminal.notes || 'Not available'}
          </p>
        </Card>
      </div>
    </section>
  );
}
