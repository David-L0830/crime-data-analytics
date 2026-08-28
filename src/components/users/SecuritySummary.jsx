import Card from '../ui/Card';
import { Icons } from '../icons';

// The Security panel under the account table.
//
// Each line is a condition that is either true of the loaded accounts or not
// shown at all. There is no fixed list of "checks" that always renders with a
// green tick next to it regardless of state — an alert that is always present
// stops being read, and one that is fabricated is worse than none in a system
// that holds crime records.
//
// When nothing is wrong the panel says so once, plainly, instead of listing
// reassurances.
export default function SecuritySummary({ users }) {
  const alerts = [];

  const withoutFactor = users.filter((u) => !u.twoFactorEnabled);
  const adminsWithoutFactor = withoutFactor.filter(
    (u) => u.role === 'badac_admin',
  );
  const inactive = users.filter((u) => !u.isActive);

  // Administrator accounts are called out separately from the rest: an
  // Administrator without a second factor is the account that can reach User
  // Management, System Settings and the full audit trail.
  if (adminsWithoutFactor.length > 0) {
    alerts.push({
      key: 'admin-2fa',
      tone: 'danger',
      text:
        adminsWithoutFactor.length === 1
          ? `1 administrator account has no second factor enrolled (${adminsWithoutFactor[0].fullName}).`
          : `${adminsWithoutFactor.length} administrator accounts have no second factor enrolled.`,
    });
  }

  const othersWithoutFactor = withoutFactor.length - adminsWithoutFactor.length;
  if (othersWithoutFactor > 0) {
    alerts.push({
      key: 'other-2fa',
      tone: 'warning',
      text:
        othersWithoutFactor === 1
          ? '1 other account has no second factor enrolled.'
          : `${othersWithoutFactor} other accounts have no second factor enrolled.`,
    });
  }

  if (inactive.length > 0) {
    alerts.push({
      key: 'inactive',
      tone: 'warning',
      text:
        inactive.length === 1
          ? `1 inactive account (${inactive[0].fullName}) — it cannot sign in, and its records and audit history are retained.`
          : `${inactive.length} inactive accounts — they cannot sign in, and their records and audit history are retained.`,
    });
  }

  return (
    <Card title="Security" className="security-summary-card">
      {alerts.length === 0 ? (
        <p className="security-alert security-alert-ok">
          <Icons.ShieldCheck size={16} strokeWidth={2} />
          Account security looks good — every account is active and has a second
          factor enrolled.
        </p>
      ) : (
        <ul className="security-alert-list">
          {alerts.map((alert) => (
            <li
              key={alert.key}
              className={`security-alert security-alert-${alert.tone}`}
            >
              <Icons.ShieldAlert size={16} strokeWidth={2} />
              {alert.text}
            </li>
          ))}
        </ul>
      )}

      {/* Stated once, here, rather than implied by a green tick somewhere:
          enrolling a factor and being challenged for it at sign-in are two
          different things, and only the first is true today. */}
      <p className="security-alert-note">
        Enrolment status is read from Supabase. Note that this application does
        not currently challenge for a second factor during sign-in, so an
        enrolled factor protects the account only where Supabase itself requires
        it.
      </p>
    </Card>
  );
}
