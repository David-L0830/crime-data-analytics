import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { formatDateTime } from '../../utils/helpers';

// View Details for one account.
//
// The rule this modal is built around: every field is either a value the
// system genuinely holds, or an explicit statement that it does not. Nothing
// is filled in with a plausible-looking default.
//
// Two fields deserve their reason recorded, because both look like omissions
// otherwise:
//
//  - Last Login reads "Never" only when the account truly has no LOGIN row in
//    the audit trail, and a real timestamp otherwise (see User::lastLoginAt()
//    on the backend). It is never a guess derived from `updated_at`.
//  - Authentication Level is knowable only for the person making the request:
//    `aal` is a claim on the caller's own verified Supabase token, read by
//    SupabaseTokenValidator. There is no supported way to ask Supabase what
//    assurance level someone else's current session reached, so for any other
//    account this says "Not available" rather than inventing AAL1.
export default function UserDetailsModal({ user, currentUser, open, onClose }) {
  if (!user) return null;

  const isSelf = user.id === currentUser?.id;
  const created = formatDateTime(user.createdAt);
  const lastLogin = formatDateTime(user.lastLoginAt);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="User Details"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="user-details-header">
        <div className="user-details-avatar" aria-hidden="true">
          {user.avatar}
        </div>
        <div>
          <h3 className="user-details-name">{user.fullName}</h3>
          <p className="user-details-username">{user.username}</p>
          <Badge status={user.isActive ? 'Active' : 'Inactive'} />
        </div>
      </div>

      <section className="user-details-section">
        <h4>Account</h4>
        <dl className="user-details-list">
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Role</dt>
          <dd>{user.roleLabel}</dd>
          <dt>Created</dt>
          <dd>{created ?? 'Not available'}</dd>
          <dt>Last login</dt>
          <dd>{lastLogin ?? 'Never'}</dd>
        </dl>
      </section>

      <section className="user-details-section">
        <h4>Security</h4>
        <dl className="user-details-list">
          <dt>Two-factor</dt>
          <dd>
            <Badge status={user.twoFactorEnabled ? 'Active' : 'Inactive'} />
            <span className="user-details-inline-note">
              {user.twoFactorEnabled
                ? 'An authenticator factor is enrolled with Supabase.'
                : 'No authenticator factor is enrolled.'}
            </span>
          </dd>
          <dt>Authentication level</dt>
          <dd>
            {isSelf
              ? (currentUser?.authAssuranceLevel?.toUpperCase() ??
                'Not available')
              : 'Not available'}
            {!isSelf && (
              <span className="user-details-inline-note">
                Only readable for your own signed-in session.
              </span>
            )}
          </dd>
        </dl>
      </section>
    </Modal>
  );
}
