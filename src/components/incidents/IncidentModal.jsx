import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { formatDate, formatTime, exportCSV, today } from '../../utils/helpers';
import { useToast } from '../../hooks/useToast';
import PrintReport from '../ui/PrintReport';
import { Icons } from '../icons';

export function IncidentViewModal({
  incident,
  onClose,
  onEdit,
  onArchive,
  archiving,
}) {
  const { showToast } = useToast();
  if (!incident) return null;
  const r = incident;

  return (
    <Modal
      open={Boolean(incident)}
      onClose={onClose}
      title={`Incident: ${r.caseNumber}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {onEdit && (
            <Button variant="secondary" onClick={() => onEdit(r)}>
              <Icons.Edit size={15} strokeWidth={2} /> Edit
            </Button>
          )}
          {onArchive && (
            <Button
              variant="danger"
              onClick={() => onArchive(r)}
              disabled={archiving}
            >
              <Icons.Archive size={15} strokeWidth={2} />{' '}
              {archiving ? 'Archiving…' : 'Archive'}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              window.print();
              showToast('Use browser print dialog to save as PDF', 'info');
            }}
          >
            <Icons.Report size={15} strokeWidth={2} /> Export PDF
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (
                exportCSV([r], `incident_${r.caseNumber}_${today()}.csv`, () =>
                  showToast('Could not export incident.', 'error'),
                )
              )
                showToast('Incident exported as CSV', 'success');
            }}
          >
            <Icons.Download size={15} strokeWidth={2} /> Export CSV
          </Button>
        </>
      }
    >
      <PrintReport title={`Incident Report: ${r.caseNumber}`} />
      <div className="detail-body">
        <div className="detail-grid">
          <div>
            <strong>Case Number:</strong> {r.caseNumber}
          </div>
          <div>
            <strong>Incident ID:</strong> {r.incidentId || '—'}
          </div>
          <div>
            <strong>Crime Type:</strong> {r.crimeType}
          </div>
          <div>
            <strong>Category:</strong> {r.category}
          </div>
          <div>
            <strong>Date:</strong> {formatDate(r.date)}
          </div>
          <div>
            <strong>Time:</strong> {formatTime(r.time)}
          </div>
          <div>
            <strong>Status:</strong> <Badge status={r.status} />
          </div>
          <div>
            <strong>Sitio:</strong> {r.sitio}
          </div>
          <div>
            <strong>Location:</strong> {r.street}
          </div>
          <div>
            <strong>Barangay:</strong> Barangay 178
          </div>
          <div>
            <strong>Latitude:</strong> {r.latitude ?? '—'}
          </div>
          <div>
            <strong>Longitude:</strong> {r.longitude ?? '—'}
          </div>
          <div
            className="full"
            style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}
          />
          <div>
            <strong>Victim Name:</strong> {r.victimName || '—'}
          </div>
          <div>
            <strong>Victim Age:</strong> {r.victimAge ?? '—'}
          </div>
          <div>
            <strong>Victim Gender:</strong> {r.victimGender || '—'}
          </div>
          <div
            className="full"
            style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}
          />
          <div>
            <strong>Suspect Name:</strong> {r.suspectName || '—'}
          </div>
          <div>
            <strong>Suspect Age:</strong> {r.suspectAge ?? '—'}
          </div>
          <div
            className="full"
            style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}
          />
          <div>
            <strong>Reporting Officer:</strong> {r.reportingOfficer || '—'}
          </div>
          <div>
            <strong>Investigating Officer:</strong>{' '}
            {r.investigatingOfficer || '—'}
          </div>
          <div>
            <strong>Badge Number:</strong> {r.badgeNumber || '—'}
          </div>
          <div>
            <strong>Unit:</strong> {r.unit || '—'}
          </div>
          <div
            className="full"
            style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}
          />
          <div className="full">
            <strong>Description:</strong> {r.description || '—'}
          </div>
          <div className="full">
            <strong>Evidence:</strong> {r.evidence || '—'}
          </div>
          <div className="full">
            <strong>Synced At:</strong>{' '}
            {r.synced_at ? new Date(r.synced_at).toLocaleString('en-PH') : '—'}
          </div>
        </div>
      </div>
    </Modal>
  );
}

const emptyForm = {
  caseNumber: '',
  crimeType: '',
  category: '',
  status: '',
  date: '',
  time: '',
  sitio: '',
  street: '',
  latitude: '',
  longitude: '',
  victimName: '',
  victimAge: '',
  victimGender: '',
  suspectName: '',
  suspectAge: '',
  reportingOfficer: '',
  investigatingOfficer: '',
  badgeNumber: '',
  unit: '',
  description: '',
  evidence: '',
};

// Shared form body for both create and edit — keeps the two modals visually
// and behaviorally identical (Part H-27: Encoder needs this same form to
// "enter crime type/category, incident date/time, location, sitio/street,
// case/status, and save records").
function IncidentFormFields({
  form,
  set,
  crimeTypes,
  categories,
  sitios,
  statuses,
}) {
  return (
    <div className="form-grid">
      <div className="form-group">
        <label>Case Number *</label>
        <input value={form.caseNumber} onChange={set('caseNumber')} required />
      </div>
      <div className="form-group">
        <label>Crime Type *</label>
        <select value={form.crimeType} onChange={set('crimeType')} required>
          <option value="">Select…</option>
          {crimeTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Category</label>
        <select value={form.category} onChange={set('category')}>
          <option value="">Select…</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Status</label>
        <select value={form.status} onChange={set('status')}>
          <option value="">Select…</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Date *</label>
        <input type="date" value={form.date} onChange={set('date')} required />
      </div>
      <div className="form-group">
        <label>Time</label>
        <input type="time" value={form.time} onChange={set('time')} />
      </div>
      <div className="form-group">
        <label>Sitio *</label>
        <select value={form.sitio} onChange={set('sitio')} required>
          <option value="">Select…</option>
          {sitios.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Location / Street</label>
        <input value={form.street} onChange={set('street')} />
      </div>
      <div className="form-group">
        <label>Latitude</label>
        <input
          type="number"
          step="any"
          value={form.latitude}
          onChange={set('latitude')}
        />
      </div>
      <div className="form-group">
        <label>Longitude</label>
        <input
          type="number"
          step="any"
          value={form.longitude}
          onChange={set('longitude')}
        />
      </div>
      <div className="form-group">
        <label>Victim Name</label>
        <input value={form.victimName} onChange={set('victimName')} />
      </div>
      <div className="form-group">
        <label>Victim Age</label>
        <input
          type="number"
          min="0"
          value={form.victimAge}
          onChange={set('victimAge')}
        />
      </div>
      <div className="form-group">
        <label>Victim Gender</label>
        <select value={form.victimGender} onChange={set('victimGender')}>
          <option value="">—</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
      </div>
      <div className="form-group">
        <label>Suspect Name</label>
        <input value={form.suspectName} onChange={set('suspectName')} />
      </div>
      <div className="form-group">
        <label>Suspect Age</label>
        <input
          type="number"
          min="0"
          value={form.suspectAge}
          onChange={set('suspectAge')}
        />
      </div>
      <div className="form-group">
        <label>Reporting Officer</label>
        <input
          value={form.reportingOfficer}
          onChange={set('reportingOfficer')}
        />
      </div>
      <div className="form-group">
        <label>Investigating Officer</label>
        <input
          value={form.investigatingOfficer}
          onChange={set('investigatingOfficer')}
        />
      </div>
      <div className="form-group">
        <label>Badge Number</label>
        <input value={form.badgeNumber} onChange={set('badgeNumber')} />
      </div>
      <div className="form-group">
        <label>Unit</label>
        <input value={form.unit} onChange={set('unit')} />
      </div>
      <div className="form-group full">
        <label>Description</label>
        <textarea
          rows={3}
          value={form.description}
          onChange={set('description')}
        />
      </div>
      <div className="form-group full">
        <label>Evidence</label>
        <input value={form.evidence} onChange={set('evidence')} />
      </div>
    </div>
  );
}

export function IncidentCreateModal({
  open,
  onClose,
  onSave,
  crimeTypes,
  categories,
  sitios,
  statuses,
  typeCategoryMap,
  validate,
}) {
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    if (open) {
      setForm(emptyForm);
      setErrors([]);
    }
  }, [open]);

  const set = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === 'crimeType' && typeCategoryMap[value])
        next.category = typeCategoryMap[value];
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const data = {
      ...form,
      victimAge: form.victimAge ? parseInt(form.victimAge, 10) : null,
      suspectAge: form.suspectAge ? parseInt(form.suspectAge, 10) : null,
      latitude: form.latitude ? parseFloat(form.latitude) : null,
      longitude: form.longitude ? parseFloat(form.longitude) : null,
      status: form.status || 'Open',
    };
    const validationErrors = validate(data);
    if (validationErrors.length) {
      setErrors(validationErrors);
      return;
    }
    await onSave(data);
  };

  return (
    <Modal open={open} onClose={onClose} title="New Incident" size="lg">
      <form onSubmit={handleSubmit}>
        {errors.length > 0 && (
          <div className="form-errors">
            <ul>
              {errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          </div>
        )}
        <IncidentFormFields
          form={form}
          set={set}
          crimeTypes={crimeTypes}
          categories={categories}
          sitios={sitios}
          statuses={statuses}
        />
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            <Icons.Save size={15} strokeWidth={2} /> Save Incident
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function IncidentEditModal({
  incident,
  open,
  onClose,
  onSave,
  crimeTypes,
  categories,
  sitios,
  statuses,
  typeCategoryMap,
  validate,
}) {
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    if (incident) {
      setForm({
        caseNumber: incident.caseNumber || '',
        crimeType: incident.crimeType || '',
        category: incident.category || '',
        status: incident.status || '',
        date: incident.date || '',
        time: incident.time || '',
        sitio: incident.sitio || '',
        street: incident.street || '',
        latitude: incident.latitude ?? '',
        longitude: incident.longitude ?? '',
        victimName: incident.victimName || '',
        victimAge: incident.victimAge ?? '',
        victimGender: incident.victimGender || '',
        suspectName: incident.suspectName || '',
        suspectAge: incident.suspectAge ?? '',
        reportingOfficer: incident.reportingOfficer || '',
        investigatingOfficer: incident.investigatingOfficer || '',
        badgeNumber: incident.badgeNumber || '',
        unit: incident.unit || '',
        description: incident.description || '',
        evidence: incident.evidence || '',
      });
      setErrors([]);
    }
  }, [incident]);

  const set = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === 'crimeType' && typeCategoryMap[value])
        next.category = typeCategoryMap[value];
      return next;
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = {
      ...form,
      victimAge: form.victimAge ? parseInt(form.victimAge, 10) : null,
      suspectAge: form.suspectAge ? parseInt(form.suspectAge, 10) : null,
      latitude: form.latitude ? parseFloat(form.latitude) : incident.latitude,
      longitude: form.longitude
        ? parseFloat(form.longitude)
        : incident.longitude,
    };
    const validationErrors = validate(data, incident?.id);
    if (validationErrors.length) {
      setErrors(validationErrors);
      return;
    }
    onSave(incident.id, data);
  };

  if (!incident) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit Incident: ${incident.caseNumber}`}
      size="lg"
    >
      <form onSubmit={handleSubmit}>
        {errors.length > 0 && (
          <div className="form-errors">
            <ul>
              {errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          </div>
        )}
        <IncidentFormFields
          form={form}
          set={set}
          crimeTypes={crimeTypes}
          categories={categories}
          sitios={sitios}
          statuses={statuses}
        />
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            <Icons.Save size={15} strokeWidth={2} /> Save Changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
