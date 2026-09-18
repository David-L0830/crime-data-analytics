import { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import Table from '../ui/Table';
import Button from '../ui/Button';
import ValidationBadge from '../ui/ValidationBadge';
import { Icons } from '../icons';
import { formatDate } from '../../utils/helpers';

/**
 * The record validation queue.
 *
 * WHAT DECIDES WHAT IS IN HERE: `incidents.validation_status`, and nothing
 * else. This list is derived from the same `records` array the rest of Crime
 * Data Collection reads, so it is always consistent with the table behind it
 * and refreshes on the existing poll without a request of its own.
 *
 * It is deliberately NOT built from notifications. An announcement says
 * something happened; it does not say whether the record has been reviewed,
 * it is per-person, and marking it read changes nothing about the record. A
 * queue built on read/unread state would empty itself when somebody glanced
 * at it. Reading is not reviewing.
 *
 * OPENING THIS PERFORMS NO WRITE OF ANY KIND — no request, no notification
 * marker, no record change. It is a filtered view of data already in memory.
 * The only things that empty it are approve() and returnForCorrection(),
 * which are real state transitions on the server.
 *
 * Reviewing reuses the page's own IncidentViewModal rather than duplicating a
 * viewer here: `onOpenRecord` hands the record back to Crime Data Collection,
 * which already renders that modal with the approve/return controls and
 * already routes them through the existing endpoints and their server-side
 * guards.
 */

const TABS = [
  { key: 'pending', label: 'Pending Validation' },
  { key: 'returned', label: 'Returned for Correction' },
];

export default function ValidationQueueModal({
  open,
  onClose,
  pending,
  returned,
  onOpenRecord,
}) {
  const [tab, setTab] = useState('pending');

  // Reopening always starts on the work queue rather than wherever the last
  // visit left off — returning from a review should not strand the validator
  // on the tab they were not working in.
  useEffect(() => {
    if (open) setTab('pending');
  }, [open]);

  const rows = tab === 'pending' ? pending : returned;

  const columns = useMemo(() => {
    const base = [
      { key: 'caseNumber', label: 'Case #' },
      { key: 'crimeType', label: 'Type' },
      { key: 'date', label: 'Date', render: formatDate },
      { key: 'sitio', label: 'Sitio' },
      // reportingOfficer, not reportedBy: the latter is a stringified user id
      // (IncidentResource line 81), meaningful for ownership checks but not
      // something to show a reviewer.
      {
        key: 'reportingOfficer',
        label: 'Reporting officer',
        render: (v) => v || '—',
      },
      {
        key: 'validationStatus',
        label: 'Validation',
        render: (v) => <ValidationBadge status={v} />,
      },
    ];

    // Only meaningful on the returned tab, where it is the whole point: the
    // encoder needs to see what was asked for.
    if (tab === 'returned') {
      base.splice(5, 0, {
        key: 'correctionReason',
        label: 'Correction requested',
        render: (v) => v || '—',
      });
    }

    return base;
  }, [tab]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record Validation"
      size="lg"
    >
      <div className="validation-queue">
        <p className="validation-queue-intro">
          Records awaiting review. Opening a record here does not change it —
          use Validate Record or Return for Correction inside the record.
        </p>

        <div
          className="validation-queue-tabs"
          role="tablist"
          aria-label="Validation queue"
        >
          {TABS.map((t) => {
            const count = t.key === 'pending' ? pending.length : returned.length;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                className={`validation-queue-tab ${active ? 'active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                <span className="validation-queue-tab-count">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="table-wrap">
          <Table
            columns={columns}
            rows={rows}
            emptyMessage={
              tab === 'pending'
                ? 'No records are waiting for validation.'
                : 'No records have been returned for correction.'
            }
            actions={(row) => (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onOpenRecord(row)}
                aria-label={`Review case ${row.caseNumber}`}
              >
                <Icons.ShieldCheck size={14} strokeWidth={2} /> Review
              </Button>
            )}
          />
        </div>
      </div>
    </Modal>
  );
}
