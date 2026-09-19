import { useCallback, useEffect, useMemo, useState } from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import ConfirmActionModal from '../components/users/ConfirmActionModal';
import { Icons } from '../components/icons';
import { useToast } from '../hooks/useToast';
import { useData } from '../hooks/useData';
import { useAuth } from '../hooks/useAuth';
import { reportScheduleService } from '../services/reportScheduleService';
import { SITIOS, STATUSES, DAY_NAMES } from '../utils/constants';
import { formatDateTime } from '../utils/helpers';

// A generated report is always official-data scoped (ReportGenerator applies
// Incident::scopeOfficial(), which excludes Archived unconditionally), so a
// schedule's Case-status filter can never actually match an Archived record.
// Offering it here would let a schedule be saved that silently produces an
// empty report on every run, forever, with nothing telling the person who
// created it why.
const SCHEDULE_STATUSES = STATUSES.filter((s) => s !== 'Archived');

// Reports — automated report schedules and their delivery log (/reports, in
// the REPORTING sidebar section; /scheduled-reports redirects here).
//
// WHO SEES WHAT
//   Administrator      every control: create, edit, pause/resume, archive,
//                      restore, Run Now; full recipients and delivery errors.
//   BADAC Validator    the same lists, read only: no controls at all, a
//                      recipient COUNT instead of addresses, and the bare
//                      delivery result without the error text.
//   Encoder            no access ('reports' is not in its modules).
//
// The controls are gated on can('manage_reports') for a clean read-only page,
// but that is NOT the security boundary: every write endpoint is
// role:badac_admin server-side, and the server never SENDS recipient addresses
// or raw errors to a non-administrator in the first place — so this page reads
// `recipients` and `error` only when they are present, and never needs to hide
// them.
//
// There is no delete. A schedule is archived (kept, with its delivery history,
// and never sent) and can be restored from the Archived view.
//
// The page never displays or downloads report content: a schedule's output is
// an e-mail attachment to a configured recipient, and no endpoint returns the
// records.

const PERIODS = [
  ['last_7_days', 'Last 7 days'],
  ['last_30_days', 'Last 30 days'],
  ['month_to_date', 'Month to date'],
  ['previous_month', 'Previous month'],
  ['all_time', 'All dates'],
];
const PERIOD_LABELS = Object.fromEntries(PERIODS);

const FREQUENCIES = [
  ['daily', 'Daily'],
  ['weekly', 'Weekly'],
  ['monthly', 'Monthly'],
];

// The one report the server can generate without a browser. Incidents have an
// unambiguous rolling period (the date the crime occurred); criminal and victim
// records do not. See ReportGenerator on the server.
//
// Labelled 'Crime Incident Report', not 'Crime Data Collection' — the latter
// is the name of the module this data is exported FROM, and using it here as
// well made every report look like a raw copy of the data-entry screen rather
// than the output of the CDARS reporting process. Mirrors
// ReportGenerator::REPORTS on the server, which is where this label actually
// comes from (see reportLabel in the schedule/log API responses); this array
// only drives the "Report type" choice in the create form.
const REPORTS = [['incidents', 'Crime Incident Report']];

const EMPTY_FORM = {
  name: '',
  report_key: 'incidents',
  period: 'last_30_days',
  frequency: 'weekly',
  hour: 6,
  day_of_week: 1,
  day_of_month: 1,
  recipients: '',
  crimeType: '',
  category: '',
  sitio: '',
  status: '',
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;

function describeSchedule(s) {
  const at = hourLabel(s.hour);
  if (s.frequency === 'daily') return `Daily at ${at}`;
  if (s.frequency === 'weekly') return `Every ${DAY_NAMES[s.dayOfWeek ?? 1]} at ${at}`;
  return `Day ${s.dayOfMonth ?? 1} of each month at ${at}`;
}

// Active / Paused / Failed. "Failed" means the schedule is still switched on
// but its most recent run did not send, which is the state an administrator
// most needs to see first.
function scheduleState(s) {
  if (!s.isActive) return 'paused';
  if (s.lastRunStatus === 'failed') return 'failed';
  return 'active';
}

const STATE_LABELS = {
  active: 'Active',
  paused: 'Paused',
  failed: 'Failed',
  archived: 'Archived',
};

// "2 recipients". The only recipient information a Validator response
// contains; an administrator's response also carries the addresses.
const recipientCountLabel = (n) =>
  `${n ?? 0} recipient${n === 1 ? '' : 's'}`;

function StateBadge({ state }) {
  return (
    <span className={`schedule-state schedule-state-${state}`}>
      <span className="validation-dot" aria-hidden="true" />
      {STATE_LABELS[state]}
    </span>
  );
}

function formFromSchedule(s) {
  return {
    name: s.name || '',
    report_key: s.reportKey || 'incidents',
    period: s.period || 'last_30_days',
    frequency: s.frequency || 'weekly',
    hour: s.hour ?? 6,
    day_of_week: s.dayOfWeek ?? 1,
    day_of_month: s.dayOfMonth ?? 1,
    recipients: (s.recipients || []).join(', '),
    crimeType: s.filters?.crimeType || '',
    category: s.filters?.category || '',
    sitio: s.filters?.sitio || '',
    status: s.filters?.status || '',
  };
}

/** Client-side checks that mirror the server's rules, for immediate feedback. */
function validateForm(form) {
  const errors = {};
  if (!form.name.trim()) errors.name = 'Enter a schedule name.';
  const recipients = form.recipients
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  if (recipients.length === 0) {
    errors.recipients = 'Add at least one recipient e-mail address.';
  } else if (recipients.length > 20) {
    errors.recipients = 'A schedule can have at most 20 recipients.';
  } else {
    const bad = recipients.find((r) => !EMAIL_PATTERN.test(r));
    if (bad) errors.recipients = `"${bad}" is not a valid e-mail address.`;
  }
  const hour = Number(form.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    errors.hour = 'Choose an hour from 00 to 23.';
  }
  if (form.frequency === 'monthly') {
    const d = Number(form.day_of_month);
    if (!Number.isInteger(d) || d < 1 || d > 28) {
      errors.day_of_month = 'Choose a day from 1 to 28.';
    }
  }
  return { errors, recipients };
}

function ScheduleFormModal({
  open,
  editing,
  crimeTypes,
  categories,
  onClose,
  onSaved,
}) {
  const { showToast } = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(editing ? formFromSchedule(editing) : EMPTY_FORM);
    setErrors({});
    setServerError('');
  }, [open, editing]);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const errorProps = (key) =>
    errors[key]
      ? { 'aria-invalid': true, 'aria-describedby': `sched-${key}-error` }
      : {};
  const errorText = (key) =>
    errors[key] ? (
      <div className="field-error" id={`sched-${key}-error`}>
        {errors[key]}
      </div>
    ) : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;

    const { errors: found, recipients } = validateForm(form);
    setErrors(found);
    if (Object.keys(found).length) return;

    // Only the four whitelisted filters, and only when set: an unset control
    // means "no filtering on that field", the same rule as every FilterBar.
    const filters = {};
    if (form.crimeType) filters.crimeType = form.crimeType;
    if (form.category) filters.category = form.category;
    if (form.sitio) filters.sitio = form.sitio;
    if (form.status) filters.status = form.status;

    const payload = {
      name: form.name.trim(),
      report_key: form.report_key,
      period: form.period,
      frequency: form.frequency,
      hour: Number(form.hour),
      day_of_week:
        form.frequency === 'weekly' ? Number(form.day_of_week) : null,
      day_of_month:
        form.frequency === 'monthly' ? Number(form.day_of_month) : null,
      recipients,
      filters,
    };

    setSaving(true);
    setServerError('');
    try {
      if (editing) {
        await reportScheduleService.update(editing.id, payload);
        showToast(`Report schedule "${payload.name}" updated`, 'success');
      } else {
        await reportScheduleService.create(payload);
        showToast(`Report schedule "${payload.name}" created`, 'success');
      }
      onSaved();
    } catch (err) {
      setServerError(err.message || 'Could not save the report schedule.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title={editing ? 'Edit Report Schedule' : 'Create Report Schedule'}
      size="lg"
    >
      <form className="schedule-form" onSubmit={handleSubmit} noValidate>
        <fieldset className="schedule-fieldset">
          <legend>Report</legend>
          <div className="form-grid">
            <div className="form-group full">
              <label htmlFor="sched-name">Schedule name</label>
              <input
                id="sched-name"
                type="text"
                maxLength={150}
                placeholder="e.g. Weekly Crime Summary"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                {...errorProps('name')}
              />
              {errorText('name')}
            </div>
            <div className="form-group">
              <label htmlFor="sched-report">Report type</label>
              <select
                id="sched-report"
                value={form.report_key}
                onChange={(e) => setField('report_key', e.target.value)}
              >
                {REPORTS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="sched-period">Period covered</label>
              <select
                id="sched-period"
                value={form.period}
                onChange={(e) => setField('period', e.target.value)}
              >
                {PERIODS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className="schedule-fieldset">
          <legend>Schedule</legend>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="sched-frequency">Frequency</label>
              <select
                id="sched-frequency"
                value={form.frequency}
                onChange={(e) => setField('frequency', e.target.value)}
              >
                {FREQUENCIES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="sched-hour">Time (server time)</label>
              <select
                id="sched-hour"
                value={form.hour}
                onChange={(e) => setField('hour', e.target.value)}
                {...errorProps('hour')}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
              {errorText('hour')}
            </div>
            {form.frequency === 'weekly' && (
              <div className="form-group">
                <label htmlFor="sched-day-of-week">Day of week</label>
                <select
                  id="sched-day-of-week"
                  value={form.day_of_week}
                  onChange={(e) => setField('day_of_week', e.target.value)}
                >
                  {DAY_NAMES.map((name, i) => (
                    <option key={name} value={i}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {form.frequency === 'monthly' && (
              <div className="form-group">
                <label htmlFor="sched-day-of-month">Day of month</label>
                {/* 1-28 only: a schedule on the 29th-31st would silently skip
                    February. The server rejects those values too. */}
                <input
                  id="sched-day-of-month"
                  type="number"
                  min="1"
                  max="28"
                  value={form.day_of_month}
                  onChange={(e) => setField('day_of_month', e.target.value)}
                  {...errorProps('day_of_month')}
                />
                {errorText('day_of_month')}
              </div>
            )}
          </div>
        </fieldset>

        <fieldset className="schedule-fieldset">
          <legend>Recipients</legend>
          <div className="form-group">
            <label htmlFor="sched-recipients">E-mail addresses</label>
            <textarea
              id="sched-recipients"
              rows={2}
              placeholder="punong.barangay@example.com, badac@example.com"
              value={form.recipients}
              onChange={(e) => setField('recipients', e.target.value)}
              {...(errors.recipients
                ? {
                    'aria-invalid': true,
                    'aria-describedby':
                      'sched-recipients-error sched-recipients-hint',
                  }
                : { 'aria-describedby': 'sched-recipients-hint' })}
            />
            <p className="form-hint" id="sched-recipients-hint">
              Separate addresses with commas. The report is sent as a CSV
              attachment; recipients do not need a CDARS account.
            </p>
            {errorText('recipients')}
          </div>
        </fieldset>

        <fieldset className="schedule-fieldset">
          <legend>Filters (optional)</legend>
          <p className="form-hint">
            Leave a filter on “All” for no filtering on that field.
          </p>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="sched-crime-type">Crime type</label>
              <select
                id="sched-crime-type"
                value={form.crimeType}
                onChange={(e) => setField('crimeType', e.target.value)}
              >
                <option value="">All</option>
                {crimeTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="sched-category">Category</label>
              <select
                id="sched-category"
                value={form.category}
                onChange={(e) => setField('category', e.target.value)}
              >
                <option value="">All</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="sched-sitio">Sitio</label>
              <select
                id="sched-sitio"
                value={form.sitio}
                onChange={(e) => setField('sitio', e.target.value)}
              >
                <option value="">All</option>
                {SITIOS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="sched-status">Case status</label>
              <select
                id="sched-status"
                value={form.status}
                onChange={(e) => setField('status', e.target.value)}
              >
                <option value="">All</option>
                {SCHEDULE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        {serverError && (
          <div className="login-error" role="alert">
            {serverError}
          </div>
        )}

        <div className="modal-footer">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            <Icons.Save size={15} strokeWidth={2} />{' '}
            {saving
              ? 'Saving…'
              : editing
                ? 'Save Changes'
                : 'Create Report Schedule'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function ScheduledReports() {
  const { showToast } = useToast();
  const { CRIME_TYPES, CATEGORIES } = useData();
  const { can } = useAuth();
  const canManage = can('manage_reports');
  // 'active' | 'archived' — which schedules the list shows.
  const [view, setView] = useState('active');
  const showingArchived = view === 'archived';
  const [schedules, setSchedules] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  // id of the schedule whose request is in flight, so only that row disables.
  const [busyId, setBusyId] = useState(null);
  // { type: 'archive' | 'restore' | 'run', schedule }
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [s, l] = await Promise.all([
        reportScheduleService.list({ archived: showingArchived }),
        reportScheduleService.logs(),
      ]);
      setSchedules(s || []);
      setLogs(l || []);
    } catch (err) {
      setLoadError(err.message || 'Could not load report schedules.');
    } finally {
      setLoading(false);
    }
  }, [showingArchived]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const counts = useMemo(() => {
    const out = { active: 0, paused: 0, failed: 0 };
    schedules.forEach((s) => {
      out[scheduleState(s)] += 1;
    });
    return out;
  }, [schedules]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (s) => {
    setEditing(s);
    setFormOpen(true);
  };

  const handleSaved = async () => {
    setFormOpen(false);
    setEditing(null);
    await load();
  };

  const handleToggle = async (s) => {
    setBusyId(s.id);
    try {
      await reportScheduleService.update(s.id, { is_active: !s.isActive });
      await load();
      showToast(`"${s.name}" ${s.isActive ? 'paused' : 'resumed'}`, 'success');
    } catch (err) {
      showToast(err.message || 'Could not update the schedule', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleRun = async (s) => {
    setBusyId(s.id);
    try {
      const result = await reportScheduleService.run(s.id);
      await load();
      // A failed SEND still resolves — the request succeeded and the outcome
      // is in the log row. It must not be reported as a success.
      if (result?.log?.status === 'sent') {
        showToast(
          `"${s.name}" sent to ${recipientCountLabel(result.log.recipientCount)} — ${result.log.rowCount} record(s)`,
          'success',
        );
      } else {
        showToast(
          `"${s.name}" failed to send. See the delivery log for the reason.`,
          'error',
        );
      }
    } catch (err) {
      showToast(err.message || 'Could not run the schedule', 'error');
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  };

  // Archive and restore never change pause state, and neither touches the
  // delivery log: an archived schedule keeps its history and is simply never
  // sent until it is restored.
  const handleArchive = async (s) => {
    setBusyId(s.id);
    try {
      await reportScheduleService.archive(s.id);
      await load();
      showToast(`"${s.name}" archived`, 'success');
    } catch (err) {
      showToast(err.message || 'Could not archive the schedule', 'error');
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  };

  const handleRestore = async (s) => {
    setBusyId(s.id);
    try {
      await reportScheduleService.restore(s.id);
      await load();
      showToast(
        `"${s.name}" restored${s.isActive ? '' : ' (still paused)'}`,
        'success',
      );
    } catch (err) {
      showToast(err.message || 'Could not restore the schedule', 'error');
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  };

  const confirming = confirm?.schedule;
  const confirmBusy = Boolean(confirming && busyId === confirming.id);

  let schedulesBody;
  if (loading) {
    schedulesBody = (
      <div className="module-state" role="status">
        <span className="spinner spinner-inline" aria-hidden="true" /> Loading
        report schedules…
      </div>
    );
  } else if (loadError) {
    schedulesBody = (
      <div className="module-state module-state-error" role="alert">
        <Icons.AlertTriangle size={20} strokeWidth={2} aria-hidden="true" />
        <div>
          <strong>Report schedules could not be loaded.</strong>
          <p>{loadError}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setLoading(true);
            load();
          }}
        >
          <Icons.Sync size={14} strokeWidth={2} /> Try again
        </Button>
      </div>
    );
  } else if (schedules.length === 0 && showingArchived) {
    schedulesBody = (
      <div className="module-empty">
        <Icons.CalendarClock size={32} strokeWidth={1.5} aria-hidden="true" />
        <h3>No archived report schedules</h3>
        <p>Archived schedules are kept here with their delivery history.</p>
      </div>
    );
  } else if (schedules.length === 0) {
    schedulesBody = (
      <div className="module-empty">
        <Icons.CalendarClock size={32} strokeWidth={1.5} aria-hidden="true" />
        <h3>No report schedules yet</h3>
        <p>
          {canManage
            ? 'Create a schedule to e-mail the Crime Incident Report to barangay officials automatically — daily, weekly or monthly.'
            : 'No reports are currently scheduled.'}
        </p>
        {canManage && (
          <Button variant="primary" onClick={openCreate}>
            <Icons.Plus size={15} strokeWidth={2} /> Create Report Schedule
          </Button>
        )}
      </div>
    );
  } else {
    schedulesBody = (
      <div className="table-wrap">
        <Table
          className="schedule-table"
          columns={[
            {
              key: 'name',
              label: 'Schedule',
              render: (v, row) => (
                <div className="cell-stack">
                  <strong>{v}</strong>
                  <span>
                    {row.reportLabel} · {PERIOD_LABELS[row.period] || row.period}
                  </span>
                </div>
              ),
            },
            {
              key: 'frequency',
              label: 'Frequency',
              render: (_v, row) => describeSchedule(row),
            },
            {
              key: 'recipientCount',
              label: 'Recipients',
              // Addresses exist in the row only for an administrator; a
              // Validator response has the count and nothing else.
              render: (count, row) => {
                const list = row.recipients;
                if (!Array.isArray(list)) return recipientCountLabel(count);
                if (!list.length) return '—';
                return (
                  <span title={list.join(', ')}>
                    {list[0]}
                    {list.length > 1 ? ` +${list.length - 1} more` : ''}
                  </span>
                );
              },
            },
            {
              key: 'nextRunAt',
              label: 'Next Run',
              render: (v, row) => {
                if (row.isArchived) return 'Archived';
                return row.isActive ? formatDateTime(v) || '—' : 'Paused';
              },
            },
            {
              key: 'lastRunAt',
              label: 'Last Run',
              render: (v, row) => (
                <div className="cell-stack">
                  <span>{formatDateTime(v) || 'Never'}</span>
                  {row.lastRunStatus && (
                    <span
                      className={
                        row.lastRunStatus === 'sent'
                          ? 'delivery-sent'
                          : 'delivery-failed'
                      }
                    >
                      {row.lastRunStatus === 'sent' ? 'Last sent' : 'Delivery failed'}
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: 'isActive',
              label: 'Status',
              render: (_v, row) => (
                <div className="cell-stack">
                  <StateBadge state={scheduleState(row)} />
                  {row.isArchived && <StateBadge state="archived" />}
                </div>
              ),
            },
          ]}
          rows={schedules}
          // No actions column at all without manage_reports.
          actions={
            canManage
              ? (row) =>
                  row.isArchived ? (
                    <div className="row-actions">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyId === row.id}
                        onClick={() =>
                          setConfirm({ type: 'restore', schedule: row })
                        }
                        aria-label={`Restore ${row.name}`}
                      >
                        Restore
                      </Button>
                    </div>
                  ) : (
                    <div className="row-actions">
                      <Button
                        size="sm"
                        variant="secondary"
                        // A paused schedule never sends, by any path; the
                        // server refuses Run Now for it too.
                        disabled={busyId === row.id || !row.isActive}
                        title={
                          row.isActive ? undefined : 'Resume this schedule to run it'
                        }
                        onClick={() => setConfirm({ type: 'run', schedule: row })}
                        aria-label={`Run ${row.name} now`}
                      >
                        <Icons.Send size={14} strokeWidth={2} /> Run now
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyId === row.id}
                        onClick={() => openEdit(row)}
                        aria-label={`Edit ${row.name}`}
                      >
                        <Icons.Edit size={14} strokeWidth={2} /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyId === row.id}
                        onClick={() => handleToggle(row)}
                        aria-label={`${row.isActive ? 'Pause' : 'Resume'} ${row.name}`}
                      >
                        {row.isActive ? 'Pause' : 'Resume'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyId === row.id}
                        onClick={() =>
                          setConfirm({ type: 'archive', schedule: row })
                        }
                        aria-label={`Archive ${row.name}`}
                      >
                        Archive
                      </Button>
                    </div>
                  )
              : undefined
          }
        />
      </div>
    );
  }

  return (
    <section className="module scheduled-reports">
      <div className="module-intro">
        <div>
          {/* States where Reports sits in the CDARS process, so this page
              does not read as an unrelated fifth module: it is the output
              stage of Crime Data Collection -> Validation -> Analytics ->
              Reporting, and it draws only from the same validated, official
              records the Dashboard, Statistical Analysis and Trend and
              Pattern Detection already show. */}
          <p className="module-intro-text">
            Reports are generated from validated, official CDARS records
            only — the same data shown on the Dashboard, Statistical
            Analysis and Trend and Pattern Detection. Configure a schedule
            to generate the Crime Incident Report on the server and e-mail
            it to barangay officials automatically — daily, weekly or
            monthly. Every delivery, automatic or manual, is recorded in
            the log below.
          </p>
        </div>
        {canManage && (
          <Button variant="primary" onClick={openCreate}>
            <Icons.Plus size={15} strokeWidth={2} /> Create Report Schedule
          </Button>
        )}
      </div>

      <div className="row-actions" role="group" aria-label="Schedules to show">
        <Button
          size="sm"
          variant={showingArchived ? 'secondary' : 'primary'}
          aria-pressed={!showingArchived}
          onClick={() => setView('active')}
        >
          Active
        </Button>
        <Button
          size="sm"
          variant={showingArchived ? 'primary' : 'secondary'}
          aria-pressed={showingArchived}
          onClick={() => setView('archived')}
        >
          Archived
        </Button>
      </div>

      {!loading && !loadError && !showingArchived && schedules.length > 0 && (
        <ul className="summary-chips" aria-label="Schedule summary">
          <li>
            <StateBadge state="active" /> <strong>{counts.active}</strong>
          </li>
          <li>
            <StateBadge state="paused" /> <strong>{counts.paused}</strong>
          </li>
          <li>
            <StateBadge state="failed" /> <strong>{counts.failed}</strong>
          </li>
        </ul>
      )}

      <Card title={showingArchived ? 'Archived Schedules' : 'Schedules'}>
        {schedulesBody}
      </Card>

      <Card title="Delivery Log">
        <p className="settings-note">
          The most recent report runs: the report, how many recipients and
          records it had, and whether it was sent. Report contents are never
          stored in this log.
        </p>
        {loading ? (
          <div className="module-state" role="status">
            <span className="spinner spinner-inline" aria-hidden="true" />{' '}
            Loading delivery log…
          </div>
        ) : (
          <div className="table-wrap">
            <Table
              columns={[
                {
                  key: 'generatedAt',
                  label: 'Date/Time',
                  render: (v) => formatDateTime(v) || '—',
                },
                { key: 'scheduleName', label: 'Schedule' },
                {
                  key: 'recipientCount',
                  label: 'Recipients',
                  // Addresses only when the server included them (an
                  // administrator's response); otherwise the count.
                  render: (count, row) =>
                    Array.isArray(row.recipients)
                      ? row.recipients.join(', ') || '—'
                      : recipientCountLabel(count),
                },
                {
                  key: 'rowCount',
                  label: 'Records',
                  render: (v) => (v === null || v === undefined ? '—' : v),
                },
                {
                  key: 'trigger',
                  label: 'Trigger',
                  render: (v, row) =>
                    v === 'manual'
                      ? `Manual${row.triggeredBy ? ` (${row.triggeredBy})` : ''}`
                      : 'Scheduled',
                },
                {
                  key: 'status',
                  label: 'Result',
                  // Not a Badge: the status pills are the crime-record status
                  // vocabulary, and a delivery result is not a record status.
                  render: (v, row) => (
                    <div className="cell-stack">
                      <span
                        className={v === 'sent' ? 'delivery-sent' : 'delivery-failed'}
                      >
                        {v === 'sent' ? 'Sent' : 'Failed'}
                      </span>
                      {row.error ? <span>{row.error}</span> : null}
                    </div>
                  ),
                },
              ]}
              rows={logs}
              emptyMessage="No reports have been generated yet."
            />
          </div>
        )}
      </Card>

      {/* Mounted only for manage_reports: a Validator page has no form and no
          confirmation dialogs at all. */}
      {canManage && (
        <>
          <ScheduleFormModal
            open={formOpen}
            editing={editing}
            crimeTypes={CRIME_TYPES}
            categories={CATEGORIES}
            onClose={() => {
              setFormOpen(false);
              setEditing(null);
            }}
            onSaved={handleSaved}
          />

          <ConfirmActionModal
            open={confirm?.type === 'archive'}
            title="Archive report schedule?"
            confirmLabel="Archive Schedule"
            busyLabel="Archiving…"
            busy={confirmBusy}
            onConfirm={() => handleArchive(confirming)}
            onClose={() => setConfirm(null)}
          >
            {confirming && (
              <p className="confirm-text">
                <strong>{confirming.name}</strong> will stop sending and move to
                Archived. Nothing is deleted: its settings and delivery history
                are kept, and it can be restored at any time.
              </p>
            )}
          </ConfirmActionModal>

          <ConfirmActionModal
            open={confirm?.type === 'restore'}
            title="Restore report schedule?"
            confirmLabel="Restore Schedule"
            busyLabel="Restoring…"
            busy={confirmBusy}
            onConfirm={() => handleRestore(confirming)}
            onClose={() => setConfirm(null)}
          >
            {confirming && (
              <p className="confirm-text">
                <strong>{confirming.name}</strong> will return to the active
                list.{' '}
                {confirming.isActive
                  ? 'It was active when archived, so it will send again on its schedule.'
                  : 'It was paused when archived and stays paused until resumed.'}
              </p>
            )}
          </ConfirmActionModal>

          <ConfirmActionModal
            open={confirm?.type === 'run'}
            title="Send this report now?"
            confirmLabel="Send Now"
            busyLabel="Sending…"
            busy={confirmBusy}
            onConfirm={() => handleRun(confirming)}
            onClose={() => setConfirm(null)}
          >
            {confirming && (
              <p className="confirm-text">
                <strong>{confirming.name}</strong> will be generated and e-mailed
                immediately to {recipientCountLabel(confirming.recipientCount)}.
              </p>
            )}
          </ConfirmActionModal>
        </>
      )}
    </section>
  );
}
