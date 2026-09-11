import { useCallback, useEffect, useState } from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Table from '../ui/Table';
import Badge from '../ui/Badge';
import { Icons } from '../icons';
import { useToast } from '../../hooks/useToast';
import { reportScheduleService } from '../../services/reportScheduleService';
import { CRIME_TYPES, CATEGORIES, SITIOS, STATUSES } from '../../utils/constants';

// Scheduled Reports — Administrator only.
//
// Rendered from Settings, which only ROLES.badac_admin can reach. That is NOT
// the security boundary: every endpoint this component calls carries
// role:badac_admin middleware server-side (see backend/routes/api.php), so an
// Encoder or a read-only BADAC account that called them directly is refused
// with a 403 whether or not they ever saw this panel.
//
// The panel does two things and deliberately no more: it configures schedules,
// and it shows the log of what those schedules actually sent. It never
// displays or downloads report content — a schedule's output is an attachment
// on a message to a configured recipient, and there is no endpoint here that
// would return the records over HTTP.

const PERIODS = [
  ['last_7_days', 'Last 7 days'],
  ['last_30_days', 'Last 30 days'],
  ['month_to_date', 'Month to date'],
  ['previous_month', 'Previous month'],
  ['all_time', 'All dates'],
];

const FREQUENCIES = [
  ['daily', 'Daily'],
  ['weekly', 'Weekly'],
  ['monthly', 'Monthly'],
];

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// The report the server can generate without a browser. Only one today, and
// deliberately so: an automated report needs an unambiguous rolling period,
// and incidents have one (the date the crime occurred). Criminal and victim
// records carry no comparable date, so "the last 30 days" of them would mean
// whichever of two different things somebody guessed. See ReportGenerator.
const REPORTS = [['incidents', 'Crime Data Collection']];

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

const formatDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('en-PH') : '—';

const describeSchedule = (s) => {
  const at = `${String(s.hour).padStart(2, '0')}:00`;
  if (s.frequency === 'daily') return `Daily at ${at}`;
  if (s.frequency === 'weekly')
    return `${DAY_NAMES[s.dayOfWeek ?? 1]}s at ${at}`;
  return `Day ${s.dayOfMonth ?? 1} of each month at ${at}`;
};

export default function ScheduledReportsSection() {
  const { showToast } = useToast();
  const [schedules, setSchedules] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  // id of the schedule whose request is in flight, so only that row's
  // controls disable — mirrors busyCrimeTypeId in Settings.jsx.
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        reportScheduleService.list(),
        reportScheduleService.logs(),
      ]);
      setSchedules(s || []);
      setLogs(l || []);
    } catch (err) {
      showToast(err.message || 'Could not load scheduled reports', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleCreate = async () => {
    if (saving) return;

    const name = form.name.trim();
    if (!name) {
      showToast('Give the schedule a name', 'error');
      return;
    }

    // Split on commas and drop the empties, so a trailing comma or a stray
    // space does not become an empty recipient the server has to reject.
    const recipients = form.recipients
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);

    if (recipients.length === 0) {
      showToast('Add at least one recipient e-mail address', 'error');
      return;
    }

    // Only the four filters this report offers are sent, and only when set.
    // An unset control means "no filtering on that field", exactly as it does
    // on every FilterBar in the application.
    const filters = {};
    if (form.crimeType) filters.crimeType = form.crimeType;
    if (form.category) filters.category = form.category;
    if (form.sitio) filters.sitio = form.sitio;
    if (form.status) filters.status = form.status;

    setSaving(true);
    try {
      await reportScheduleService.create({
        name,
        report_key: form.report_key,
        period: form.period,
        frequency: form.frequency,
        hour: Number(form.hour),
        day_of_week: form.frequency === 'weekly' ? Number(form.day_of_week) : null,
        day_of_month:
          form.frequency === 'monthly' ? Number(form.day_of_month) : null,
        recipients,
        filters,
      });
      setForm(EMPTY_FORM);
      await load();
      showToast(`Scheduled report "${name}" created`, 'success');
    } catch (err) {
      showToast(err.message || 'Could not create the schedule', 'error');
    } finally {
      setSaving(false);
    }
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
      // is in the log row. Reporting it as a success because no exception was
      // thrown would be the one thing this panel must not do.
      if (result?.log?.status === 'sent') {
        showToast(
          `"${s.name}" sent to ${result.log.recipients.length} recipient(s) — ${result.log.rowCount} record(s)`,
          'success',
        );
      } else {
        showToast(
          `"${s.name}" failed to send. See the log below for the reason.`,
          'error',
        );
      }
    } catch (err) {
      showToast(err.message || 'Could not run the schedule', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (s) => {
    setBusyId(s.id);
    try {
      await reportScheduleService.remove(s.id);
      await load();
      // The email log keeps its rows: deleting a schedule stops future sends,
      // it does not erase the record of the sends that already happened.
      showToast(`"${s.name}" deleted`, 'success');
    } catch (err) {
      showToast(err.message || 'Could not delete the schedule', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Card title="Scheduled Reports">
        <p className="settings-note">
          An automated report is generated on the server and e-mailed to the
          recipients below. The message carries the report as a CSV attachment
          and never contains the records themselves. Only an Administrator can
          create, run or delete a schedule.
        </p>

        <div className="form-group">
          <label htmlFor="sched-name">Schedule Name</label>
          <input
            id="sched-name"
            type="text"
            placeholder="e.g. Weekly Crime Summary"
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="sched-report">Report</label>
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
          <label htmlFor="sched-period">Period Covered</label>
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

        {form.frequency === 'weekly' && (
          <div className="form-group">
            <label htmlFor="sched-day-of-week">Day of Week</label>
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
            <label htmlFor="sched-day-of-month">Day of Month</label>
            {/* 1-28 only. A schedule on the 29th-31st would silently skip
                February, which looks like a broken feature rather than an
                impossible setting. The server rejects those values too. */}
            <input
              id="sched-day-of-month"
              type="number"
              min="1"
              max="28"
              value={form.day_of_month}
              onChange={(e) => setField('day_of_month', e.target.value)}
            />
          </div>
        )}

        <div className="form-group">
          <label htmlFor="sched-hour">Hour (24h, server time)</label>
          <input
            id="sched-hour"
            type="number"
            min="0"
            max="23"
            value={form.hour}
            onChange={(e) => setField('hour', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="sched-recipients">
            Recipients (comma-separated e-mail addresses)
          </label>
          <input
            id="sched-recipients"
            type="text"
            placeholder="punong.barangay@example.com, badac@example.com"
            value={form.recipients}
            onChange={(e) => setField('recipients', e.target.value)}
          />
        </div>

        <p className="settings-note">
          Filters are optional. An empty filter means no filtering on that
          field — the same rule the report screens use.
        </p>

        <div className="form-group">
          <label htmlFor="sched-crime-type">Crime Type</label>
          <select
            id="sched-crime-type"
            value={form.crimeType}
            onChange={(e) => setField('crimeType', e.target.value)}
          >
            <option value="">All</option>
            {CRIME_TYPES.map((t) => (
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
            {CATEGORIES.map((c) => (
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
          <label htmlFor="sched-status">Status</label>
          <select
            id="sched-status"
            value={form.status}
            onChange={(e) => setField('status', e.target.value)}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <Button onClick={handleCreate} disabled={saving}>
          <Icons.Save size={15} strokeWidth={2} />{' '}
          {saving ? 'Creating…' : 'Create Schedule'}
        </Button>

        <div className="table-wrap" style={{ marginTop: 20 }}>
          <Table
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'reportLabel', label: 'Report' },
              {
                key: 'frequency',
                label: 'Runs',
                render: (_v, row) => describeSchedule(row),
              },
              {
                key: 'recipients',
                label: 'Recipients',
                render: (v) => (v || []).join(', ') || '—',
              },
              {
                key: 'lastRunAt',
                label: 'Last Run',
                render: (v) => formatDateTime(v),
              },
              {
                key: 'isActive',
                label: 'State',
                // 'Active' / 'Inactive' are the two status pills the shared
                // stylesheet actually defines; inventing a 'Paused' one here
                // would render an unstyled badge.
                render: (v) => <Badge status={v ? 'Active' : 'Inactive'} />,
              },
            ]}
            rows={schedules}
            emptyMessage={
              loading
                ? 'Loading scheduled reports…'
                : 'No scheduled reports configured.'
            }
            actions={(row) => (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busyId === row.id}
                  onClick={() => handleRun(row)}
                >
                  Run now
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busyId === row.id}
                  onClick={() => handleToggle(row)}
                >
                  {row.isActive ? 'Pause' : 'Resume'}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busyId === row.id}
                  onClick={() => handleDelete(row)}
                >
                  Delete
                </Button>
              </>
            )}
          />
        </div>
      </Card>

      {/* The "Email Logs" evidence. Every run lands here, successful or not —
          the failed run is the one an administrator most needs to find. The
          rows describe the report (how many records, over what scope) and
          never contain it. */}
      <Card title="Report Email Log">
        <p className="settings-note">
          Every automated and manual report run is recorded here: the report,
          the recipients, the scope it covered, how many records it contained,
          and whether it was sent. Report contents are never stored in this
          log.
        </p>

        <div className="table-wrap">
          <Table
            columns={[
              {
                key: 'generatedAt',
                label: 'Date/Time',
                render: (v) => formatDateTime(v),
              },
              { key: 'scheduleName', label: 'Schedule' },
              { key: 'reportLabel', label: 'Report' },
              {
                key: 'recipients',
                label: 'Recipients',
                render: (v) => (v || []).join(', ') || '—',
              },
              {
                key: 'rowCount',
                label: 'Records',
                render: (v) => (v === null || v === undefined ? '—' : v),
              },
              { key: 'trigger', label: 'Trigger' },
              {
                key: 'status',
                label: 'Result',
                // Not a Badge: the status pills are a fixed record-status
                // vocabulary (Open, Solved, Archived...), and borrowing one of
                // them to mean "the e-mail went out" would put a crime-record
                // status on a delivery result.
                render: (v, row) => (
                  <>
                    <span
                      style={{
                        color:
                          v === 'sent' ? 'var(--success)' : 'var(--danger)',
                        fontWeight: 600,
                      }}
                    >
                      {v === 'sent' ? 'Sent' : 'Failed'}
                    </span>
                    {row.error ? (
                      <div
                        style={{
                          color: 'var(--text-muted)',
                          fontSize: '0.8rem',
                        }}
                      >
                        {row.error}
                      </div>
                    ) : null}
                  </>
                ),
              },
            ]}
            rows={logs}
            emptyMessage={
              loading
                ? 'Loading report email log…'
                : 'No reports have been generated yet.'
            }
          />
        </div>
      </Card>
    </>
  );
}
