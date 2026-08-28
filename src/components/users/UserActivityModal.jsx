import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { userService } from '../../services/userService';
import { ApiError } from '../../services/api';
import { formatClockTime } from '../../utils/helpers';

// User Activity for one account.
//
// This reads the EXISTING audit trail — the same audit_logs rows the Audit
// Logs module renders — scoped to the selected user's id by the backend (GET
// /users/{id}/activity). No second activity log exists, nothing new is
// recorded to make this view work, and no entry is synthesised: if an account
// has done nothing that the application audits, this says so.
//
// Scoping happens on the server rather than by filtering the global feed in
// the browser, because GET /audit-logs returns only the most recent 200 rows
// system-wide; a quiet user's history would silently vanish behind a busy
// week of someone else's activity.
//
// Rows are grouped by day so a timeline of one afternoon reads as times
// rather than as repeated full dates.
function groupByDay(entries) {
  const groups = [];
  entries.forEach((entry) => {
    const day = new Date(entry.timestamp).toLocaleDateString('en-PH', {
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const existing = groups.find((g) => g.day === day);
    if (existing) existing.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  });
  return groups;
}

export default function UserActivityModal({ user, open, onClose }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    setError('');
    userService
      .activity(user.id)
      .then(setEntries)
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : 'Unable to load this account’s activity. Please try again.',
        ),
      )
      .finally(() => setLoading(false));
  }, [open, user]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="User Activity"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <p className="user-activity-subject">{user?.fullName}</p>

      {loading ? (
        <div className="empty-state" style={{ padding: 40 }}>
          <div className="spinner" />
        </div>
      ) : error ? (
        <div className="login-error">{error}</div>
      ) : entries.length === 0 ? (
        <p className="user-activity-empty">
          No recorded activity for this account yet.
        </p>
      ) : (
        <>
          {groupByDay(entries).map((group) => (
            <div key={group.day} className="user-activity-group">
              <h4>{group.day}</h4>
              <ul className="user-activity-list">
                {group.entries.map((entry) => (
                  <li key={entry.id}>
                    <span className="user-activity-time">
                      {formatClockTime(entry.timestamp) ?? '—'}
                    </span>
                    <span className="user-activity-detail">
                      <strong>{entry.action}</strong>
                      {entry.details ? ` — ${entry.details}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="user-activity-note">
            Showing this account’s 50 most recent audited actions.
          </p>
        </>
      )}
    </Modal>
  );
}
