import { useEffect, useId, useRef, useState } from 'react';
import Modal from '../ui/Modal';
import Badge from '../ui/Badge';
import ValidationBadge from '../ui/ValidationBadge';
import Button from '../ui/Button';
import {
  formatDate,
  formatDateTime,
  formatTime,
  today,
} from '../../utils/helpers';
import {
  VALIDATION_STATUS_LABELS,
  CORRECTION_REASONS,
} from '../../utils/constants';
import { exportWorkbook } from '../../utils/exportWorkbook';
import { auditLogService } from '../../services/auditLogService';
import { useToast } from '../../hooks/useToast';
import { usePendingAction } from '../../hooks/usePendingAction';
import PrintReport from '../ui/PrintReport';
import { Icons } from '../icons';
import {
  coordinatePayload,
  submissionErrorMessages,
} from './incidentSubmission';
import LocationPicker from './LocationPicker';
import { formatCoordinate, pinStateFor, PIN_STATUS } from './locationPickerState';
import { autofillPatch, reverseGeocode } from '../../utils/reverseGeocode';
import { composeReturnReason } from './returnReason';

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

// Record validation panel shown at the top of an incident's view.
//
// Everyone who can open the record sees its validation state, who reviewed it
// and when, and — for a returned record — the reason, because the encoder is
// the person who has to act on it. Only a caller that passes onApprove /
// onReturn (IncidentFeed does so for the Administrator alone) gets the review
// controls, and even then the server is the authority: both endpoints are
// role:badac_admin.
function ValidationPanel({ record, onApprove, onReturn, busy }) {
  const [returning, setReturning] = useState(false);
  const [selectedReasons, setSelectedReasons] = useState([]);
  const [customText, setCustomText] = useState('');
  const [reasonError, setReasonError] = useState('');
  const reasonId = useId();
  const reasonGroupLabelId = `${reasonId}-group-label`;

  // A different record, or the same record in a new state, starts clean.
  useEffect(() => {
    setReturning(false);
    setSelectedReasons([]);
    setCustomText('');
    setReasonError('');
  }, [record.id, record.validationStatus]);

  const status = record.validationStatus;
  const archived = record.status === 'Archived';
  const canReview = !archived && (onApprove || onReturn);

  const toggleReason = (code) => {
    setSelectedReasons((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const submitReturn = async () => {
    const composed = composeReturnReason(selectedReasons, customText);
    if (composed.length < 5) {
      setReasonError(
        'Select at least one reason, or give the encoder a custom description of at least 5 characters.',
      );
      return;
    }
    // PUT /incidents/{id}/return validates `reason` at max:1000 — unchanged,
    // see IncidentController::returnForCorrection() on the server. Composing
    // several reason labels plus a near-full custom text field can exceed
    // that on its own, so this is checked client-side with a clear message
    // rather than left to surface as a raw 422 from the API.
    if (composed.length > 1000) {
      setReasonError(
        `That is too long by ${composed.length - 1000} character(s) — shorten the additional details.`,
      );
      return;
    }
    setReasonError('');
    await onReturn(record, composed);
  };

  let detail = null;
  if (status === 'validated') {
    detail = record.validatedAt ? (
      <p className="validation-meta">
        Validated by <strong>{record.validatedBy || 'a former account'}</strong>{' '}
        on {formatDateTime(record.validatedAt)}.
      </p>
    ) : (
      <p className="validation-meta">
        Recorded before record validation was introduced and accepted as part
        of the existing official records.
      </p>
    );
  } else if (status === 'returned') {
    detail = (
      <>
        <p className="validation-meta">
          Returned by <strong>{record.returnedBy || 'a former account'}</strong>
          {record.returnedAt
            ? ` on ${formatDateTime(record.returnedAt)}`
            : ''}
          . Edit the record to correct it and resubmit it for validation.
        </p>
        {record.correctionReason && (
          <blockquote className="validation-reason">
            <span className="validation-reason-label">Correction requested</span>
            {record.correctionReason}
          </blockquote>
        )}
      </>
    );
  } else {
    detail = (
      <>
        <p className="validation-meta">
          Awaiting review by a BADAC Administrator. This record is not yet an
          official validated record.
        </p>
        {record.correctionReason && (
          <blockquote className="validation-reason">
            <span className="validation-reason-label">
              Previously returned for correction
            </span>
            {record.correctionReason}
          </blockquote>
        )}
      </>
    );
  }

  return (
    <section
      className={`validation-panel validation-panel-${status || 'unknown'}`}
      aria-label="Record validation"
    >
      <div className="validation-panel-head">
        <span className="validation-panel-title">Record Validation</span>
        <ValidationBadge status={status} />
      </div>
      {detail}

      {canReview && !returning && (
        <div className="validation-actions print-hidden">
          {onApprove && status !== 'validated' && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => onApprove(record)}
              disabled={busy}
            >
              <Icons.CheckCircle2 size={15} strokeWidth={2} />{' '}
              {busy ? 'Saving…' : 'Validate Record'}
            </Button>
          )}
          {onReturn && status !== 'returned' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setReturning(true)}
              disabled={busy}
            >
              <Icons.Return size={15} strokeWidth={2} /> Return for Correction
            </Button>
          )}
        </div>
      )}

      {canReview && returning && (
        <div className="validation-return-form print-hidden">
          <p id={reasonGroupLabelId}>
            Reason for returning <span aria-hidden="true">*</span>
          </p>
          <div
            className="validation-reason-choices"
            role="group"
            aria-labelledby={reasonGroupLabelId}
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            {CORRECTION_REASONS.map((r, index) => (
              <label key={r.code} className="form-check">
                <input
                  type="checkbox"
                  checked={selectedReasons.includes(r.code)}
                  onChange={() => toggleReason(r.code)}
                  /* eslint-disable-next-line jsx-a11y/no-autofocus */
                  autoFocus={index === 0}
                />
                <span>{r.label}</span>
              </label>
            ))}
          </div>
          <label htmlFor={reasonId}>Additional details (optional)</label>
          <textarea
            id={reasonId}
            rows={3}
            maxLength={1000}
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder="Add specific details the encoder needs — required if none of the reasons above is selected."
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={reasonError ? `${reasonId}-error` : undefined}
          />
          {reasonError && (
            <div
              className="field-error"
              id={`${reasonId}-error`}
              role="alert"
            >
              {reasonError}
            </div>
          )}
          <div className="validation-actions print-hidden">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setReturning(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={submitReturn}
              disabled={busy}
            >
              {busy ? 'Returning…' : 'Return Record'}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export function IncidentViewModal({
  incident,
  onClose,
  onEdit,
  onArchive,
  archiving,
  onRestore,
  restoring,
  onApprove,
  onReturn,
  reviewing,
}) {
  const { showToast } = useToast();

  // The shared Modal restores focus to whatever opened it on the
  // open -> closed transition. Returning null here when `incident` goes
  // null would UNMOUNT that Modal instead of closing it, so the transition
  // never happens and focus is dropped to <body>. Verified in a browser: the
  // trigger button was still in the DOM and still connected, yet focus was
  // lost — because the effect that restores it had been torn down.
  //
  // Holding the last record keeps the Modal mounted across the close, so the
  // transition runs. Nothing stale is shown: Modal renders null while
  // `open` is false, so the retained record is never displayed.
  const lastIncident = useRef(incident);
  if (incident) lastIncident.current = incident;
  const r = incident || lastIncident.current;
  // The `if (!r) return null` that used to sit here has moved below the export
  // handler: that handler is now built with a hook (usePendingAction), and a
  // hook cannot be called after a conditional return without changing the hook
  // order between renders. Nothing else changes — the component still renders
  // null when there is no record, it just decides to a few lines later.

  // Single-record export, matching the Field / Value sheet that Criminal
  // Profile and Victim Profile produce - one shared exportWorkbook helper
  // formats every export in the system rather than this one record going out
  // through a different path.
  //
  // This replaces a CSV of the raw API object, which carried the internal
  // database id, reportedBy and synced_at as reporting columns and laid a
  // single record out as one very wide row.
  // Wrapped in usePendingAction so the button can show that it is working and
  // refuses a second click while it is: exportWorkbook() pulls exceljs in on
  // first use, which is the one operation here slow enough to look broken.
  const [exporting, handleExportRecord] = usePendingAction(async () => {
    // Unreachable in practice — the button that calls this only exists once
    // there is a record — but the hook now runs on the empty render too.
    if (!r) return;
    const rows = [
      ['Case Number', r.caseNumber],
      ['Incident ID', r.incidentId],
      ['Crime Type', r.crimeType],
      ['Category', r.category],
      ['Date', formatDate(r.date)],
      ['Time', formatTime(r.time)],
      ['Status', r.status],
      [
        'Validation',
        VALIDATION_STATUS_LABELS[r.validationStatus] || r.validationStatus,
      ],
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
  });

  // Every hook has now run, so the conditional return is safe from here on.
  if (!r) return null;

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
          {onArchive && r.status !== 'Archived' && (
            <Button
              variant="danger"
              onClick={() => onArchive(r)}
              disabled={archiving}
            >
              <Icons.Archive size={15} strokeWidth={2} />{' '}
              {archiving ? 'Archiving…' : 'Archive'}
            </Button>
          )}
          {onRestore && r.status === 'Archived' && (
            <Button
              variant="secondary"
              onClick={() => onRestore(r)}
              disabled={restoring}
            >
              {restoring ? 'Restoring…' : 'Restore'}
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
          <Button
            variant="secondary"
            onClick={handleExportRecord}
            disabled={exporting}
            aria-busy={exporting}
          >
            {exporting ? (
              <>
                <span className="spinner spinner-inline" aria-hidden="true" />{' '}
                Exporting…
              </>
            ) : (
              <>
                <Icons.Download size={15} strokeWidth={2} /> Export Excel
              </>
            )}
          </Button>
        </>
      }
    >
      <PrintReport title={`Incident Report: ${r.caseNumber}`} />
      <ValidationPanel
        record={r}
        onApprove={onApprove}
        onReturn={onReturn}
        busy={reviewing}
      />
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

/** Whether a coordinate field holds nothing at all. */
function isBlankCoordinate(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

/**
 * One coordinate as the read-only display shows it.
 *
 * The formatting itself is formatCoordinate's — seven places, matching what
 * `incidents.latitude` / `longitude` store — and is not duplicated here. This
 * only decides what to show when there is nothing to format.
 *
 * An empty field reads "Not set". A stored value that CANNOT be formatted is
 * shown exactly as it is stored, rather than as "Not set": hiding a malformed
 * coordinate behind an empty-looking placeholder would misrepresent the record,
 * and this form is not allowed to correct it either. The encoder has to be able
 * to see what is actually there before deciding to replace or clear it.
 */
function coordinateDisplay(value) {
  if (isBlankCoordinate(value)) return 'Not set';
  return formatCoordinate(value) || String(value);
}

/**
 * How long a newly placed pin must sit still before its street is looked up.
 *
 * Dragging a marker produces one final position, but CLICKING around the map
 * while deciding produces several in a row. Half a second is long enough that
 * a person still choosing does not fire a request per candidate, and short
 * enough that it feels like part of placing the pin rather than a separate
 * step. The in-flight request is aborted on every change regardless, so this is
 * about not making the requests at all rather than about ignoring the answers.
 */
const LOCATION_LOOKUP_DELAY_MS = 500;

/**
 * What the encoder is told about the automatic lookup, keyed by its state.
 *
 * Every message ends somewhere the encoder can act, because none of these
 * states stops them saving: the Sitio select and the Street field stay exactly
 * as editable as they were, and a lookup that found nothing or failed outright
 * leaves the form in precisely the condition it is in today.
 *
 * `determined` is built rather than looked up, because it has to name what was
 * actually filled — which of the two fields, and with what — rather than claim
 * both were.
 */
const LOOKUP_MESSAGES = {
  looking: 'Looking up the street for this pin…',
  none: 'OpenStreetMap does not name a street at this point. Enter the Sitio and Location / Street yourself — nothing has been filled in.',
  unavailable:
    'The street lookup could not be reached, so nothing was filled in. Enter the Sitio and Location / Street yourself.',
};

/**
 * The sentence describing a successful lookup, or null when it filled nothing.
 *
 * Only ever describes fields this feature ACTUALLY wrote. A lookup that found a
 * street the encoder had already typed over changes nothing and says nothing,
 * rather than implying the form now holds the map's answer.
 */
function lookupFilledMessage(patch) {
  const filled = ['sitio', 'street']
    .filter((field) => typeof patch[field] === 'string' && patch[field] !== '')
    .map((field) => `${field === 'sitio' ? 'Sitio' : 'Location / Street'}: ${patch[field]}`);

  if (!filled.length) return null;
  return `Filled from the map — ${filled.join(', ')}. Correct either field if the report says otherwise.`;
}

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
  // Set by IncidentEditModal when the incident being edited is Archived.
  // `statuses` never contains 'Archived', so without this the select would
  // fall back to its blank first option and a plain "fix a typo" save would
  // read as a status change away from Archived.
  statusLocked = false,
}) {
  // These fields are rendered twice in this file — once inside
  // IncidentCreateModal and once inside IncidentEditModal — and IncidentFeed
  // holds `creating` and `editing` as independent state, so nothing
  // structurally stops both from being mounted at the same moment. A
  // hand-written id prefix would then be emitted twice and every label would
  // point at whichever copy of the control the browser found first. useId()
  // gives each instance its own prefix, so the two cannot collide however the
  // page is driven.
  const uid = useId();

  // ===== Pin -> Sitio / street =====
  //
  // WHAT THIS DOES, AND THE THREE THINGS IT IS NOT ALLOWED TO DO
  //
  // When a pin is placed INSIDE Barangay 178, OpenStreetMap is asked what is at
  // that exact point and the answer is offered to the Sitio and Location /
  // Street fields. It saves the encoder typing a street that the map already
  // knows, and it makes the street on the record agree with the street under
  // the pin.
  //
  //   1. It does not validate. The decision about which points may be recorded
  //      is pinStateFor's here and ValidatesIncidentLocation's on the server,
  //      both reading the stored boundary polygon. This runs only for points
  //      those have already accepted, and a failed or empty lookup changes
  //      nothing about what can be saved.
  //   2. It does not invent. src/utils/reverseGeocode.js returns null rather
  //      than a nearest-plausible answer, and a Sitio is accepted only when
  //      OpenStreetMap names one this form's own dropdown already offers.
  //   3. It does not overrule the encoder. autofillPatch writes only into a
  //      blank field or into a value this effect itself wrote; text somebody
  //      typed is never overwritten and never cleared.
  //
  // Both coordinate fields are the FORM's, so nothing here holds a second copy
  // of the location — this reads the pair the picker already set and writes
  // back through the same setValue every other field uses.
  const [lookupMessage, setLookupMessage] = useState(null);

  // The values this effect last wrote, so a stale answer of its own can be
  // replaced or withdrawn while the encoder's own text cannot. A ref rather
  // than state: it is read inside the effect and must never cause a render,
  // because a render that re-ran the lookup would re-derive what it just wrote.
  const autoFilledRef = useRef({ street: null, sitio: null });

  // The latest Sitio/street, the latest setter and the latest options, read
  // through refs so the effect below can depend on the COORDINATES ALONE.
  // Depending on `form` would re-run the lookup on every keystroke anywhere in
  // the form; depending on `setValue` — a new arrow function on each of the
  // parent's renders — would re-run it on every render, which with a write
  // inside is an update loop.
  const lookupInputsRef = useRef({ street: '', sitio: '', setValue, sitios });
  useEffect(() => {
    lookupInputsRef.current = {
      street: form.street,
      sitio: form.sitio,
      setValue,
      sitios,
    };
  });

  useEffect(() => {
    const state = pinStateFor(form.latitude, form.longitude);

    // Cleared, half-written, unusable, or a stored point outside the barangay.
    // None of those is a point to ask about, and an out-of-area coordinate in
    // particular must not be handed to a Barangay 178 street lookup as though
    // it were one.
    if (state.status !== PIN_STATUS.INSIDE) {
      // The pin was cleared, or the record holds a coordinate that cannot be
      // pinned. Either way this feature's own values were derived from a point
      // the form no longer has, so they are withdrawn on exactly the rule
      // autofillPatch applies when a pin MOVES somewhere unnamed — a blank
      // result and nothing previously written leaves the fields alone, and the
      // encoder's own text is never touched.
      const inputs = lookupInputsRef.current;
      const { patch } = autofillPatch(
        { street: inputs.street, sitio: inputs.sitio },
        { street: null, sitio: null },
        autoFilledRef.current,
      );
      Object.entries(patch).forEach(([field, value]) =>
        inputs.setValue(field, value),
      );

      autoFilledRef.current = { street: null, sitio: null };
      setLookupMessage(null);
      return undefined;
    }

    const controller = new AbortController();
    let cancelled = false;

    setLookupMessage(LOOKUP_MESSAGES.looking);

    const timer = setTimeout(() => {
      reverseGeocode(state.pin.lat, state.pin.lng, {
        signal: controller.signal,
        sitios: lookupInputsRef.current.sitios,
      }).then((found) => {
        // The pin moved on, or the modal closed, while this was in flight.
        if (cancelled) return;

        if (!found) {
          setLookupMessage(LOOKUP_MESSAGES.unavailable);
          return;
        }

        const inputs = lookupInputsRef.current;
        const { patch, written } = autofillPatch(
          { street: inputs.street, sitio: inputs.sitio },
          found,
          autoFilledRef.current,
        );

        autoFilledRef.current = written;
        Object.entries(patch).forEach(([field, value]) =>
          inputs.setValue(field, value),
        );

        // Three genuinely different outcomes, and only the middle one may say
        // that nothing is known about this point:
        //   something was filled   -> name exactly what, and with what.
        //   nothing was determined -> say so, and hand it back to the encoder.
        //   determined, but the encoder's own text is in the way -> say
        //   nothing. Their values stand, and announcing a street that was not
        //   written would read as though it had been.
        const filled = lookupFilledMessage(patch);
        const determined = found.street !== null || found.sitio !== null;

        setLookupMessage(filled ?? (determined ? null : LOOKUP_MESSAGES.none));
      });
    }, LOCATION_LOOKUP_DELAY_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [form.latitude, form.longitude]);

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
        <label htmlFor={`${uid}-case-number`}>Case Number *</label>
        <input
          id={`${uid}-case-number`}
          value={form.caseNumber}
          onChange={set('caseNumber')}
          required
        />
      </div>
      <div className="form-group">
        <label htmlFor={`${uid}-crime-type`}>Crime Type *</label>
        <select
          id={`${uid}-crime-type`}
          value={form.crimeType}
          onChange={set('crimeType')}
          required
        >
          <option value="">Select…</option>
          {crimeTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label htmlFor={`${uid}-category`}>Category</label>
        <select
          id={`${uid}-category`}
          value={form.category}
          onChange={set('category')}
        >
          <option value="">Select…</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label htmlFor={`${uid}-status`}>Status</label>
        <select
          id={`${uid}-status`}
          value={form.status}
          onChange={set('status')}
          disabled={statusLocked}
        >
          {statusLocked ? (
            <option value={form.status}>{form.status}</option>
          ) : (
            <>
              <option value="">Select…</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </>
          )}
        </select>
        {statusLocked && (
          <p className="form-hint">
            An archived incident keeps its status while you edit it. Use Restore
            to return it to its previous status.
          </p>
        )}
      </div>
      <div className="form-group">
        <label htmlFor={`${uid}-date`}>Date *</label>
        <input
          id={`${uid}-date`}
          type="date"
          value={form.date}
          onChange={set('date')}
          required
        />
      </div>
      <div className="form-group">
        <label htmlFor={`${uid}-time`}>Time</label>
        <input
          id={`${uid}-time`}
          type="time"
          value={form.time}
          onChange={set('time')}
        />
      </div>
      <div className="form-group">
        <label htmlFor={`${uid}-sitio`}>Sitio *</label>
        <select
          id={`${uid}-sitio`}
          value={form.sitio}
          onChange={set('sitio')}
          required
        >
          <option value="">Select…</option>
          {sitios.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label htmlFor={`${uid}-street`}>Location / Street</label>
        <input
          id={`${uid}-street`}
          value={form.street}
          onChange={set('street')}
        />
      </div>
      {/* LOCATION — a map, not two number boxes.

          Latitude and longitude are no longer typed. They are produced by
          LocationPicker, which refuses a point outside Barangay 178 and never
          moves one that already is. Both values stay visible, read-only, so
          the record's exact coordinates can still be read and exported — but
          the only ways to change them are to move the pin or clear them.

          Full width, because the map needs both columns of .form-grid to be
          usable at all.

          THE PICKER IS ADVISORY, NOT AUTHORITATIVE. StoreIncidentRequest /
          UpdateIncidentRequest and the ValidatesIncidentLocation concern parse
          their own copy of the boundary and remain the thing that decides what
          may be stored. Nothing here weakens that, and a coordinate that
          reached the payload another way still meets the same server test. */}
      <div className="form-group full incident-location">
        <span className="incident-location-title" id={`${uid}-location`}>
          Pin exact location on map
        </span>
        <p className="form-hint" id={`${uid}-location-hint`}>
          Click inside the Barangay 178 boundary to place the pin, or drag the
          pin to adjust it. Optional — leave it unset if this report has no
          exact location. Where the map names the street, Sitio and Location /
          Street above are filled in for you; anything you have typed yourself
          is left alone.
        </p>

        {/* Named and described for a screen reader here rather than inside the
            picker: the map is a reusable component and should not have to know
            which form it is standing in. */}
        <div
          role="group"
          aria-labelledby={`${uid}-location`}
          aria-describedby={`${uid}-location-hint`}
        >
          <LocationPicker
            latitude={form.latitude}
            longitude={form.longitude}
            // The form's own setter, twice — not a second coordinate state.
            // React applies both in one update, and the form stays the single
            // place the pair is held.
            onChange={(latitude, longitude) => {
              setValue('latitude', latitude);
              setValue('longitude', longitude);
            }}
          />
        </div>

        <div className="incident-location-footer">
          {/* A live region. Moving the pin changes these two values, and
              somebody who cannot see the map still has to be told what was
              selected. Both sit in ONE region so a single move is announced
              once rather than twice. */}
          <div className="incident-location-readout" role="status">
            <span>
              <span className="incident-location-key">Latitude</span>
              <span className="incident-location-value">
                {coordinateDisplay(form.latitude)}
              </span>
            </span>
            <span>
              <span className="incident-location-key">Longitude</span>
              <span className="incident-location-value">
                {coordinateDisplay(form.longitude)}
              </span>
            </span>
          </div>

          {/* Clearing belongs to the form, not to the picker: it changes the
              FORM's value, and it has to empty BOTH halves — coordinatePayload
              then sends null for each, which the server accepts, rather than
              leaving half a pair its required_with rule would reject. */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setValue('latitude', '');
              setValue('longitude', '');
            }}
            disabled={
              isBlankCoordinate(form.latitude) &&
              isBlankCoordinate(form.longitude)
            }
          >
            Clear location
          </Button>
        </div>

        {/* What the automatic Sitio/street lookup is doing, in its own live
            region — separate from the coordinate readout above so that moving
            the pin announces the new coordinates immediately and the lookup's
            outcome when it arrives, rather than re-reading both twice.

            Rendered only when there is something to say. A lookup that found a
            street the encoder had already typed over stays silent, because the
            form did not change and saying otherwise would imply it had. */}
        {lookupMessage && (
          <p className="form-hint incident-location-lookup" role="status">
            {lookupMessage}
          </p>
        )}
      </div>
      <div className="form-group">
        <label htmlFor={`${uid}-victim-name`}>Victim Name</label>
        <input
          id={`${uid}-victim-name`}
          value={form.victimName}
          onChange={set('victimName')}
        />
      </div>
      <div className="form-group">
        <label htmlFor={`${uid}-victim-age`}>Victim Age</label>
        <input
          id={`${uid}-victim-age`}
          type="number"
          min="0"
          value={form.victimAge}
          onChange={set('victimAge')}
        />
      </div>
      <div className="form-group">
        <label htmlFor={`${uid}-victim-gender`}>Victim Gender</label>
        <select
          id={`${uid}-victim-gender`}
          value={form.victimGender}
          onChange={set('victimGender')}
        >
          <option value="">—</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
      </div>
      <div className="form-group">
        <label htmlFor={`${uid}-suspect-name`}>Suspect Name</label>
        <input
          id={`${uid}-suspect-name`}
          value={form.suspectName}
          onChange={set('suspectName')}
        />
      </div>
      <div className="form-group">
        <label htmlFor={`${uid}-suspect-age`}>Suspect Age</label>
        <input
          id={`${uid}-suspect-age`}
          type="number"
          min="0"
          value={form.suspectAge}
          onChange={set('suspectAge')}
        />
      </div>
      <div className="form-group">
        <label htmlFor={`${uid}-reporting-officer`}>Reporting Officer</label>
        <input
          id={`${uid}-reporting-officer`}
          value={form.reportingOfficer}
          onChange={set('reportingOfficer')}
        />
      </div>
      <div className="form-group">
        <label htmlFor={`${uid}-investigating-officer`}>
          Investigating Officer
        </label>
        <input
          id={`${uid}-investigating-officer`}
          value={form.investigatingOfficer}
          onChange={set('investigatingOfficer')}
        />
      </div>
      <div className="form-group">
        <label htmlFor={`${uid}-badge-number`}>Badge Number</label>
        <input
          id={`${uid}-badge-number`}
          value={form.badgeNumber}
          onChange={set('badgeNumber')}
        />
      </div>
      <div className="form-group">
        <label htmlFor={`${uid}-unit`}>Unit</label>
        <input id={`${uid}-unit`} value={form.unit} onChange={set('unit')} />
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
            <label htmlFor={`${uid}-complainant-name`}>
              Complainant Full Name *
            </label>
            <input
              id={`${uid}-complainant-name`}
              value={form.complainantName}
              onChange={set('complainantName')}
            />
          </div>
          <div className="form-group">
            <label htmlFor={`${uid}-complainant-relationship`}>
              Relationship to Victim
            </label>
            <input
              id={`${uid}-complainant-relationship`}
              value={form.complainantRelationship}
              onChange={set('complainantRelationship')}
              placeholder="e.g. Mother"
            />
          </div>
          <div className="form-group">
            <label htmlFor={`${uid}-complainant-contact`}>
              Complainant Contact Number
            </label>
            <input
              id={`${uid}-complainant-contact`}
              value={form.complainantContact}
              onChange={set('complainantContact')}
            />
          </div>
          <div className="form-group">
            <label htmlFor={`${uid}-complainant-address`}>
              Complainant Address
            </label>
            <input
              id={`${uid}-complainant-address`}
              value={form.complainantAddress}
              onChange={set('complainantAddress')}
            />
          </div>
        </>
      )}

      <div className="form-group full">
        <label htmlFor={`${uid}-description`}>Description</label>
        <textarea
          id={`${uid}-description`}
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
        {/* A heading for the block, not a label for one control: the number
            of rows varies, so there is no single input for `htmlFor` to point
            at. The container is named as a group instead, and each row's
            inputs keep the aria-labels they already carried. */}
        <label id={`${uid}-evidence`}>Evidence</label>
        <div
          className="evidence-rows"
          role="group"
          aria-labelledby={`${uid}-evidence`}
        >
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
  // Focus target for a rejected submission — see the error summary in the
  // markup below. An effect rather than a call inside handleSubmit, because
  // setErrors does not apply synchronously and the element does not exist yet
  // at the point the handler decides there are errors.
  const errorSummaryRef = useRef(null);
  useEffect(() => {
    if (errors.length) errorSummaryRef.current?.focus();
  }, [errors]);
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
      ...coordinatePayload(form),
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
    // Clears any messages left by a previous rejected attempt, so a retry
    // never shows stale errors next to a form that has since been corrected.
    setErrors([]);
    setSubmitting(true);
    try {
      await onSave(data);
    } catch (err) {
      // A rejected save leaves the modal open with everything the encoder
      // typed still in it, and reports the server's field-level messages in
      // the same area the client-side ones use. Nothing is re-validated here.
      setErrors(submissionErrorMessages(err, 'Could not save incident.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Incident" size="lg">
      <form onSubmit={handleSubmit}>
        {errors.length > 0 && (
          <div className="form-errors">
            {/* role="alert" makes a rejected submission audible. Before this,
                the summary appeared silently at the top of a form that is
                long enough to scroll, so a screen reader user pressed Save
                and was told nothing at all — not that it failed, and not why.

                The alert region is nested inside .form-errors rather than
                being the same element, so the list keeps its own list
                semantics ("list, 3 items") instead of having them replaced by
                the alert role.

                tabIndex={-1} plus the focus effect above is the other half:
                being told there are errors is only useful if you are also put
                where they are. The summary is the one place that holds all of
                them, and it sits directly above the fields they refer to. */}
            <div role="alert" ref={errorSummaryRef} tabIndex={-1}>
              <ul>
                {errors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </div>
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
  // Focus target for a rejected submission — see the error summary in the
  // markup below. An effect rather than a call inside handleSubmit, because
  // setErrors does not apply synchronously and the element does not exist yet
  // at the point the handler decides there are errors.
  const errorSummaryRef = useRef(null);
  useEffect(() => {
    if (errors.length) errorSummaryRef.current?.focus();
  }, [errors]);
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
      ...coordinatePayload(form),
      // Blank rows are dropped here as well as server-side, so a record saved
      // with the default empty row does not travel with a meaningless item.
      evidenceItems: (form.evidenceItems || []).filter(
        (item) =>
          item.evidenceId.trim() !== '' || item.description.trim() !== '',
      ),
    };
    // 'Archived' is not an assignable status — PUT /api/incidents/{id}
    // rejects it (UpdateIncidentRequest), and only the archive endpoint may
    // write it, because only that endpoint also records previous_status.
    // Omitting the key entirely leaves the column untouched
    // (IncidentController::mapToColumns copies only keys that are present),
    // so an archived incident can still have its details corrected.
    if (incident?.status === 'Archived') {
      delete data.status;
    }
    const validationErrors = validate(data, incident?.id);
    if (validationErrors.length) {
      setErrors(validationErrors);
      return;
    }
    // Clears any messages left by a previous rejected attempt, so a retry
    // never shows stale errors next to a form that has since been corrected.
    setErrors([]);
    setSubmitting(true);
    try {
      await onSave(incident.id, data);
    } catch (err) {
      // See IncidentCreateModal: the modal stays open, the entered values
      // stay put, and the server's messages are shown inline.
      setErrors(submissionErrorMessages(err, 'Could not update incident.'));
    } finally {
      setSubmitting(false);
    }
  };

  // The shared Modal restores focus to whatever opened it on the
  // open -> closed transition. Returning null here when `incident` goes
  // null would UNMOUNT that Modal instead of closing it, so the transition
  // never happens and focus is dropped to <body>. Verified in a browser: the
  // trigger button was still in the DOM and still connected, yet focus was
  // lost — because the effect that restores it had been torn down.
  //
  // Holding the last record keeps the Modal mounted across the close, so the
  // transition runs. Nothing stale is shown: Modal renders null while
  // `open` is false, so the retained record is never displayed.
  const lastEdited = useRef(incident);
  if (incident) lastEdited.current = incident;
  const shown = incident || lastEdited.current;
  if (!shown) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit Incident: ${shown.caseNumber}`}
      size="lg"
    >
      <form onSubmit={handleSubmit}>
        {errors.length > 0 && (
          <div className="form-errors">
            {/* role="alert" makes a rejected submission audible. Before this,
                the summary appeared silently at the top of a form that is
                long enough to scroll, so a screen reader user pressed Save
                and was told nothing at all — not that it failed, and not why.

                The alert region is nested inside .form-errors rather than
                being the same element, so the list keeps its own list
                semantics ("list, 3 items") instead of having them replaced by
                the alert role.

                tabIndex={-1} plus the focus effect above is the other half:
                being told there are errors is only useful if you are also put
                where they are. The summary is the one place that holds all of
                them, and it sits directly above the fields they refer to. */}
            <div role="alert" ref={errorSummaryRef} tabIndex={-1}>
              <ul>
                {errors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </div>
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
          statusLocked={shown.status === 'Archived'}
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
