import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { formatDate, formatTime, today } from '../../utils/helpers';
import { exportWorkbook } from '../../utils/exportWorkbook';
import { auditLogService } from '../../services/auditLogService';
import { useToast } from '../../hooks/useToast';
import PrintReport from '../ui/PrintReport';
import { Icons } from '../icons';

// The complainant is whoever filed the report. Usually that is the victim
// themselves, which is what complainantIsVictim records; when it is not, the
// separate person's name is what should be shown.
function complainantSummary(r) {
  if (r.complainantIsVictim !== false) {
    return r.victimName ? `${r.victimName} (same as victim)` : 'Same as victim';
  }
  return r.complainantName || '';
}

// Evidence is a list of { evidenceId, description } records. Flattened to one
// line per item for the single-cell contexts (a spreadsheet row) that cannot
// hold a list.
function evidenceSummary(r) {
  const items = r.evidenceItems || [];
  if (!items.length) return '';
  return items.map((e) => `${e.evidenceId}: ${e.description}`).join('\n');
}

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

  // Single-record export, matching the Field / Value sheet that Criminal
  // Profile and Victim Profile produce - one shared exportWorkbook helper
  // formats every export in the system rather than this one record going out
  // through a different path.
  //
  // This replaces a CSV of the raw API object, which carried the internal
  // database id, reportedBy and synced_at as reporting columns and laid a
  // single record out as one very wide row.
  const handleExportRecord = async () => {
    const rows = [
      ['Case Number', r.caseNumber],
      ['Incident ID', r.incidentId],
      ['Crime Type', r.crimeType],
      ['Category', r.category],
      ['Date', formatDate(r.date)],
      ['Time', formatTime(r.time)],
      ['Status', r.status],
      ['Priority', r.priority],
      ['Sitio', r.sitio],
      ['Location / Street', r.street],
      ['Barangay', 'Barangay 178, North Caloocan'],
      ['Latitude', r.latitude],
      ['Longitude', r.longitude],
      ['Victim Name', r.victimName],
      ['Victim Age', r.victimAge],
      ['Victim Gender', r.victimGender],
      ['Suspect Name', r.suspectName],
      ['Suspect Age', r.suspectAge],
      ['Reporting Officer', r.reportingOfficer],
      ['Investigating Officer', r.investigatingOfficer],
      ['Badge Number', r.badgeNumber],
      ['Unit', r.unit],
      ['Complainant', complainantSummary(r)],
      [
        'Complainant Relationship to Victim',
        r.complainantIsVictim ? 'Same person' : r.complainantRelationship,
      ],
      [
        'Complainant Contact Number',
        r.complainantIsVictim ? '' : r.complainantContact,
      ],
      [
        'Complainant Address',
        r.complainantIsVictim ? '' : r.complainantAddress,
      ],
      ['Description', r.description],
      ['Evidence', evidenceSummary(r)],
    ].map(([field, value]) => ({
      field,
      value:
        value === null || value === undefined || value === ''
          ? 'Not available'
          : value,
    }));

    const ok = await exportWorkbook({
      filename: `incident_${r.caseNumber}_${today()}.xlsx`,
      sheetName: 'Incident Record',
      title: `Incident Record \u2014 ${r.caseNumber}`,
      subtitle: 'Crime Data Analytics & Reporting System',
      columns: [
        { header: 'Field', key: 'field', width: 26 },
        { header: 'Value', key: 'value', width: 70, wrap: true },
      ],
      rows,
      onEmpty: () => showToast('Could not export incident.', 'error'),
      onError: () => showToast('Could not export incident.', 'error'),
    });
    if (ok) {
      showToast('Incident exported to Excel', 'success');
      // Recorded only on success, so the audit trail never claims an
      // export that did not happen. Not awaited: a completed download
      // must not wait on, or be failed by, follow-up bookkeeping.
      auditLogService.logExport('incident-record');
    }
  };

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
            <Icons.Printer size={15} strokeWidth={2} /> Print Record
          </Button>
          <Button variant="secondary" onClick={handleExportRecord}>
            <Icons.Download size={15} strokeWidth={2} /> Export Excel
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
            <strong>Complainant:</strong>{' '}
            {r.complainantIsVictim === false
              ? r.complainantName || '—'
              : 'Same as victim'}
          </div>
          <div>
            <strong>Relationship to Victim:</strong>{' '}
            {r.complainantIsVictim === false
              ? r.complainantRelationship || '—'
              : '—'}
          </div>
          <div>
            <strong>Complainant Contact:</strong>{' '}
            {r.complainantIsVictim === false
              ? r.complainantContact || '—'
              : '—'}
          </div>
          <div>
            <strong>Complainant Address:</strong>{' '}
            {r.complainantIsVictim === false
              ? r.complainantAddress || '—'
              : '—'}
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
            <strong>Evidence:</strong>{' '}
            {r.evidenceItems && r.evidenceItems.length ? (
              <ul className="evidence-view-list">
                {r.evidenceItems.map((e) => (
                  <li key={e.id || e.evidenceId}>
                    <strong>{e.evidenceId}</strong> — {e.description}
                  </li>
                ))}
              </ul>
            ) : (
              /* Falls back to the legacy single-string column for any record
                 whose evidence has not been migrated into structured items. */
              r.evidence || '—'
            )}
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
  // Defaults to "the complainant is the victim" because that is the ordinary
  // case; the separate-complainant fields only appear when it is unticked.
  complainantIsVictim: true,
  complainantName: '',
  complainantRelationship: '',
  complainantContact: '',
  complainantAddress: '',
  // One blank row so the fields are visible rather than hidden behind an "add"
  // button; a row left entirely blank is discarded on save.
  evidenceItems: [{ evidenceId: '', description: '' }],
};

// Shared form body for both create and edit — keeps the two modals visually
// and behaviorally identical (Part H-27: Encoder needs this same form to
// "enter crime type/category, incident date/time, location, sitio/street,
// case/status, and save records").
function IncidentFormFields({
  form,
  set,
  setValue,
  crimeTypes,
  categories,
  sitios,
  statuses,
}) {
  const evidenceItems = form.evidenceItems?.length
    ? form.evidenceItems
    : [{ evidenceId: '', description: '' }];

  const setEvidence = (index, key) => (e) => {
    const value = e.target.value;
    setValue(
      'evidenceItems',
      evidenceItems.map((item, i) =>
        i === index ? { ...item, [key]: value } : item,
      ),
    );
  };

  const addEvidenceRow = () =>
    setValue('evidenceItems', [
      ...evidenceItems,
      { evidenceId: '', description: '' },
    ]);

  const removeEvidenceRow = (index) =>
    setValue(
      'evidenceItems',
      // Never leave zero rows — an empty list with no visible field would look
      // like the section had disappeared. The last row is cleared instead.
      evidenceItems.length > 1
        ? evidenceItems.filter((_, i) => i !== index)
        : [{ evidenceId: '', description: '' }],
    );

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
      {/* Complainant — who actually filed the report. Kept immediately after
          the victim fields because the question it answers ("was it this
          person who reported it?") is about them. */}
      <div className="form-group full">
        <label className="form-check">
          <input
            type="checkbox"
            checked={form.complainantIsVictim !== false}
            onChange={(e) => setValue('complainantIsVictim', e.target.checked)}
          />
          <span>Is the complainant the same person as the victim?</span>
        </label>
        <p className="form-hint">
          Untick when someone else filed the report — for example when the
          victim is hospitalised, a minor, or otherwise unable to report.
        </p>
      </div>

      {form.complainantIsVictim === false && (
        <>
          <div className="form-group">
            <label>Complainant Full Name *</label>
            <input
              value={form.complainantName}
              onChange={set('complainantName')}
            />
          </div>
          <div className="form-group">
            <label>Relationship to Victim</label>
            <input
              value={form.complainantRelationship}
              onChange={set('complainantRelationship')}
              placeholder="e.g. Mother"
            />
          </div>
          <div className="form-group">
            <label>Complainant Contact Number</label>
            <input
              value={form.complainantContact}
              onChange={set('complainantContact')}
            />
          </div>
          <div className="form-group">
            <label>Complainant Address</label>
            <input
              value={form.complainantAddress}
              onChange={set('complainantAddress')}
            />
          </div>
        </>
      )}

      <div className="form-group full">
        <label>Description</label>
        <textarea
          rows={3}
          value={form.description}
          onChange={set('description')}
        />
      </div>

      {/* Evidence — a repeatable Evidence ID + Description, replacing the
          single free-text box this used to be. Leaving the ID blank is fine:
          the server numbers the item (EV-001, EV-002, ...) so every piece of
          evidence has a reference that can be cited. */}
      <div className="form-group full">
        <label>Evidence</label>
        <div className="evidence-rows">
          {evidenceItems.map((item, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <div className="evidence-row" key={index}>
              <input
                className="evidence-row-id"
                value={item.evidenceId}
                onChange={setEvidence(index, 'evidenceId')}
                placeholder="EV-001"
                aria-label={`Evidence ID ${index + 1}`}
              />
              <input
                className="evidence-row-desc"
                value={item.description}
                onChange={setEvidence(index, 'description')}
                placeholder="e.g. CCTV footage from the entrance of the residence"
                aria-label={`Evidence description ${index + 1}`}
              />
              <button
                type="button"
                className="evidence-row-remove"
                onClick={() => removeEvidenceRow(index)}
                aria-label={`Remove evidence item ${index + 1}`}
                title="Remove this evidence item"
              >
                <Icons.Close size={14} strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={addEvidenceRow}
        >
          <Icons.Plus size={14} strokeWidth={2} /> Add Evidence Item
        </Button>
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
  // Guards against a double-click submitting the form twice. Without it two
  // POST /api/incidents fire before the first resolves; the case_number and
  // incident_code UNIQUE constraints stop a duplicate row being written, but
  // the second request still surfaces a confusing failure for a save that
  // actually succeeded. Same in-flight pattern as IncidentFeed's archive
  // action and ResetPassword's submit.
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(emptyForm);
      setErrors([]);
      setSubmitting(false);
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

  // Companion to `set` above for the fields that are not <input value> ->
  // string: the "complainant is the victim" checkbox, and the evidence list.
  const setValue = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    const data = {
      ...form,
      victimAge: form.victimAge ? parseInt(form.victimAge, 10) : null,
      suspectAge: form.suspectAge ? parseInt(form.suspectAge, 10) : null,
      latitude: form.latitude ? parseFloat(form.latitude) : null,
      longitude: form.longitude ? parseFloat(form.longitude) : null,
      status: form.status || 'Open',
      // Blank rows are dropped here as well as server-side, so a record saved
      // with the default empty row does not travel with a meaningless item.
      evidenceItems: (form.evidenceItems || []).filter(
        (item) =>
          item.evidenceId.trim() !== '' || item.description.trim() !== '',
      ),
    };
    const validationErrors = validate(data);
    if (validationErrors.length) {
      setErrors(validationErrors);
      return;
    }
    setSubmitting(true);
    try {
      await onSave(data);
    } finally {
      setSubmitting(false);
    }
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
          setValue={setValue}
          crimeTypes={crimeTypes}
          categories={categories}
          sitios={sitios}
          statuses={statuses}
        />
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
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
  // Same in-flight guard as IncidentCreateModal above — a double-click here
  // fired two PUT /api/incidents/{id} requests for one edit.
  const [submitting, setSubmitting] = useState(false);

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
        // `!== false` rather than a plain truthiness check: an incident saved
        // before this feature has no value at all, and the correct reading of
        // such a record is that it names one victim and no separate
        // complainant.
        complainantIsVictim: incident.complainantIsVictim !== false,
        complainantName: incident.complainantName || '',
        complainantRelationship: incident.complainantRelationship || '',
        complainantContact: incident.complainantContact || '',
        complainantAddress: incident.complainantAddress || '',
        evidenceItems:
          incident.evidenceItems && incident.evidenceItems.length
            ? incident.evidenceItems.map((e) => ({
                evidenceId: e.evidenceId || '',
                description: e.description || '',
              }))
            : // A record whose evidence is still the legacy free-text string
              // opens with that text as the first item's description, so
              // editing preserves it instead of quietly discarding it.
              [
                {
                  evidenceId: incident.evidence ? 'EV-001' : '',
                  description: incident.evidence || '',
                },
              ],
      });
      setErrors([]);
      setSubmitting(false);
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

  // Companion to `set` above for the fields that are not <input value> ->
  // string: the "complainant is the victim" checkbox, and the evidence list.
  const setValue = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    const data = {
      ...form,
      victimAge: form.victimAge ? parseInt(form.victimAge, 10) : null,
      suspectAge: form.suspectAge ? parseInt(form.suspectAge, 10) : null,
      latitude: form.latitude ? parseFloat(form.latitude) : incident.latitude,
      longitude: form.longitude
        ? parseFloat(form.longitude)
        : incident.longitude,
      // Blank rows are dropped here as well as server-side, so a record saved
      // with the default empty row does not travel with a meaningless item.
      evidenceItems: (form.evidenceItems || []).filter(
        (item) =>
          item.evidenceId.trim() !== '' || item.description.trim() !== '',
      ),
    };
    const validationErrors = validate(data, incident?.id);
    if (validationErrors.length) {
      setErrors(validationErrors);
      return;
    }
    setSubmitting(true);
    try {
      await onSave(incident.id, data);
    } finally {
      setSubmitting(false);
    }
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
          setValue={setValue}
          crimeTypes={crimeTypes}
          categories={categories}
          sitios={sitios}
          statuses={statuses}
        />
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            <Icons.Save size={15} strokeWidth={2} /> Save Changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
