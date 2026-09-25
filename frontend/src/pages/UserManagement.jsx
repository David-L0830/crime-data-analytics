import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { userService } from '../services/userService';
import { ApiError } from '../services/api';
import {
  emailMfaRemainsNotice,
  hasSecondFactor,
  mfaStatusLabel,
  usesAuthenticatorAppMfa,
  usesEmailOtpMfa,
} from '../utils/mfaStatus';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { Icons } from '../components/icons';
import TwoFactorSelfService from '../components/settings/TwoFactorSelfService';
import UserStatsCards from '../components/users/UserStatsCards';
import UserRowMenu from '../components/users/UserRowMenu';
import UserDetailsModal from '../components/users/UserDetailsModal';
import UserActivityModal from '../components/users/UserActivityModal';
import CreateUserModal from '../components/users/CreateUserModal';
import ReissueTemporaryPasswordModal from '../components/users/ReissueTemporaryPasswordModal';
import OneTimeCredentialModal from '../components/users/OneTimeCredentialModal';
import { temporaryCredentialLabel } from '../utils/temporaryPassword';
import EditUserModal from '../components/users/EditUserModal';
import ConfirmActionModal from '../components/users/ConfirmActionModal';
import SecuritySummary from '../components/users/SecuritySummary';
import RolePermissionsCard from '../components/users/RolePermissionsCard';
import {
  ROLE_OPTIONS,
  assignableRoleOptions,
  describeApiFailure,
} from '../components/users/userValidation';
import { formatDateTime } from '../utils/helpers';
import { MANAGEABLE_ROLES, canManageAccount } from '../utils/constants';

// Account Administration & Security Center (formerly the plain User
// Management table).
//
// The security model is unchanged and is deliberately not re-implemented
// here. This page is route-gated to roles that have the 'user-management'
// module (see ROLES in constants.js and ProtectedRoute), and the backend
// enforces the real boundary independently: every /users* endpoint and
// /role-permissions sits behind `role:badac_admin,super_admin` middleware, so
// an Encoder or BADAC account calling them directly gets a 403 before any
// controller runs, and the 'manage-account' Gate decides which accounts each
// of the two may act on. Nothing below is a security control — the account
// administration sections simply are not rendered for a role that manages no
// accounts, and no such request is even attempted for them.
//
// Two governance tiers use this page: the Super Administrator manages
// Administrator accounts, the Administrator manages Encoder and Validator
// accounts (MANAGEABLE_ROLES). Both see the whole table; a row's actions are
// offered only on the accounts the viewer manages.
//
// Encoder reaches this route only for the self-service 2FA panel that moved
// here from the old Security page (Checkpoint 28); that branch is untouched.
export default function UserManagement() {
  const { currentUser, can } = useAuth();
  const { showToast } = useToast();
  const managesAccounts = Boolean(MANAGEABLE_ROLES[currentUser?.role]);
  // Per-account activity is raw audit-log rows, which only the Super
  // Administrator reads (GET /users/{id}/activity is role:super_admin).
  const canViewActivity = can('view_audit_logs');

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(managesAccounts);
  const [loadError, setLoadError] = useState('');

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [twoFactorFilter, setTwoFactorFilter] = useState('');

  const [detailsUser, setDetailsUser] = useState(null);
  const [activityUser, setActivityUser] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Each confirmation holds the account it is about, so the dialog can name
  // it rather than saying "this user".
  const [confirm, setConfirm] = useState(null); // { type, user }
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  // Temporary passwords. `reissueUser` is the account being reissued;
  // `oneTimeCredential` is the ONE-TIME display after a successful create or
  // reissue ({ password, expiresAt, accountName, reissued }). Both live only in
  // this page's memory and are set back to null when their dialog closes —
  // which is the only place the password is ever held after submission.
  const [reissueUser, setReissueUser] = useState(null);
  const [oneTimeCredential, setOneTimeCredential] = useState(null);

  const load = () => {
    if (!managesAccounts) return;
    setLoading(true);
    setLoadError('');
    userService
      .list()
      .then(setUsers)
      .catch((err) =>
        setLoadError(
          err instanceof ApiError
            ? err.message
            : 'Unable to load users. Please try again.',
        ),
      )
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const replaceUser = (updated) =>
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((user) => {
      if (
        term &&
        ![user.fullName, user.username, user.email].some((field) =>
          field?.toLowerCase().includes(term),
        )
      )
        return false;
      if (roleFilter && user.role !== roleFilter) return false;
      if (statusFilter === 'active' && !user.isActive) return false;
      if (statusFilter === 'inactive' && user.isActive) return false;
      // hasSecondFactor, not twoFactorEnabled: an email_otp account has no
      // Supabase factor but is challenged for an emailed code at every
      // sign-in, so filtering it into "disabled" would be wrong.
      if (twoFactorFilter === 'enabled' && !hasSecondFactor(user)) return false;
      if (twoFactorFilter === 'disabled' && hasSecondFactor(user)) return false;
      return true;
    });
  }, [users, search, roleFilter, statusFilter, twoFactorFilter]);

  const filtersApplied = Boolean(
    search.trim() || roleFilter || statusFilter || twoFactorFilter,
  );

  // ---- mutations -------------------------------------------------------
  // Each returns an error string on failure (rendered inside the dialog that
  // triggered it, next to the fields it concerns) and undefined on success,
  // rather than throwing into a generic toast.

  // Sends the Supabase password email for one account and records it in the
  // audit trail. Throws if the email could not be requested; returns normally
  // once Supabase has accepted it.
  //
  // Both callers go through here — the automatic send after account creation
  // and the manual "Reset Password" action — precisely so the two cannot
  // drift apart. It is the same mechanism the public Forgot Password page
  // uses (supabase.auth.resetPasswordForEmail with a /reset-password
  // redirect, see src/pages/ForgotPassword.jsx), so a newly created account
  // and a forgotten password land on the identical screen.
  //
  // No password is generated, read, or transmitted here. Supabase owns the
  // credential; the recipient sets it themselves from the emailed link.
  const sendPasswordEmail = async (user) => {
    if (!isSupabaseConfigured) {
      throw new Error('Password email is not configured for this deployment.');
    }

    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;

    // Audited only once Supabase has accepted the send, so the trail never
    // records an email that was never dispatched. A failure to write the
    // audit row is deliberately NOT re-thrown: the email really did go out,
    // and telling the administrator it failed would send them retrying
    // something that already succeeded. The gap is an audit-trail gap only.
    try {
      await userService.logPasswordReset(user.id);
    } catch {
      /* email delivered; audit row missed */
    }
  };

  const handleCreate = async (payload) => {
    setSaving(true);
    try {
      const created = await userService.create(payload);
      setUsers((prev) =>
        [...prev, created].sort((a, b) => a.fullName.localeCompare(b.fullName)),
      );
      setCreating(false);

      // Temporary-password path: NO setup email. The administrator is shown
      // the password once — the value this browser just submitted, never
      // fetched back from the server — together with the server's own expiry.
      if (payload.temporaryPassword) {
        setOneTimeCredential({
          password: payload.temporaryPassword,
          expiresAt: created.temporaryCredentialExpiresAt,
          accountName: created.fullName,
          reissued: false,
        });
        showToast(`Account created for ${created.fullName}.`, 'success');
        return undefined;
      }

      // The account exists in both systems at this point but has no password
      // anyone knows, so it cannot be signed into until the recipient sets
      // one. Sending that email is therefore part of finishing the job, not a
      // separate courtesy.
      //
      // Its failure is contained here on purpose. The account is real and
      // correctly provisioned; deleting it because an email bounced would
      // destroy good work over a recoverable problem, and would also strand
      // the Supabase Auth half. So nothing is undone — the administrator is
      // told plainly what did and did not happen, and Reset Password on that
      // row retries just the email.
      try {
        await sendPasswordEmail(created);
        showToast(
          `Account created. A password setup email has been sent to ${created.email}.`,
          'success',
        );
      } catch {
        showToast(
          `Account created for ${created.fullName}, but the password setup email could not be sent. The account is saved — use Reset Password on their row to try sending it again.`,
          'error',
        );
      }
    } catch (err) {
      return describeApiFailure(err, 'Unable to create this account.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async (payload) => {
    if (!editing) return;
    setSaving(true);
    try {
      replaceUser(await userService.update(editing.id, payload));
      setEditing(null);
      showToast('User updated successfully.', 'success');
    } catch (err) {
      return describeApiFailure(err, 'Unable to update user.');
    } finally {
      setSaving(false);
    }
  };

  const openConfirm = (type, user) => {
    setConfirmError('');
    setConfirm({ type, user });
  };

  const closeConfirm = () => {
    setConfirm(null);
    setConfirmError('');
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const { type, user } = confirm;
    setConfirmBusy(true);
    setConfirmError('');

    try {
      if (type === 'status') {
        const next = !user.isActive;
        replaceUser(await userService.setActive(user.id, next));
        showToast(
          next
            ? 'User activated successfully.'
            : 'User deactivated successfully.',
          'success',
        );
      }

      if (type === 'two-factor') {
        replaceUser(await userService.disableTwoFactor(user.id));
        showToast(
          // For an Authenticator App account the backend resets rather than
          // removes: the requirement stays on and a new authenticator must be
          // set up, so saying MFA was cleared would be false.
          usesAuthenticatorAppMfa(user)
            ? 'Authenticator reset. They must set up a new authenticator app at their next sign-in.'
            : 'Two-factor authentication cleared for this account.' +
                emailMfaRemainsNotice(user),
          'success',
        );
      }

      if (type === 'two-factor-require') {
        replaceUser(await userService.setTwoFactorRequired(user.id, true));
        showToast(
          'Two-factor authentication is now required for this account.',
          'success',
        );
      }

      if (type === 'two-factor-cancel') {
        replaceUser(await userService.setTwoFactorRequired(user.id, false));
        showToast(
          // For an email_otp account this action lifts only the AUTHENTICATOR
          // requirement; the emailed code stays mandatory (it follows
          // users.mfa_method, which nothing here changes). Claiming MFA was
          // switched off would be false.
          usesEmailOtpMfa(user)
            ? 'The authenticator requirement was removed.' +
                emailMfaRemainsNotice(user)
            : 'Two-factor authentication is no longer required for this account.',
          'success',
        );
      }

      if (type === 'password-reset') {
        // Same helper the automatic post-creation send uses, so the manual
        // retry path and the automatic one cannot diverge. Supabase sends the
        // email; this application never sees or handles a password or a reset
        // token.
        await sendPasswordEmail(user);
        showToast('Password reset email sent successfully.', 'success');
      }

      closeConfirm();
    } catch (err) {
      setConfirmError(
        describeApiFailure(err, 'That action could not be completed.'),
      );
    } finally {
      setConfirmBusy(false);
    }
  };

  // A role that manages no accounts (Encoder): the self-service 2FA section
  // only — no account table, no account-administration request attempted.
  if (!managesAccounts) {
    return (
      <section className="module">
        <div className="module-toolbar">
          <div>
            <h2 className="module-title">
              <Icons.Users size={18} strokeWidth={2} /> User Management
            </h2>
          </div>
        </div>
        <TwoFactorSelfService />
      </section>
    );
  }

  // A row's actions are offered only on accounts this viewer manages; the
  // backend's 'manage-account' Gate refuses the rest regardless. Any other row
  // (a fellow Administrator, a Super Administrator, your own) can be viewed
  // but not changed. View Activity reads raw audit-log rows, so it follows the
  // audit-log permission instead.
  const offeredActions = (user, items) => {
    const manageable = canManageAccount(currentUser?.role, user.role);
    return items.filter((item) =>
      item.key === 'view'
        ? true
        : item.key === 'activity'
          ? canViewActivity
          : manageable,
    );
  };

  const rowMenu = (user) => {
    const isSelf = user.id === currentUser?.id;
    return (
      <UserRowMenu
        label={`Actions for ${user.fullName}`}
        items={offeredActions(user, [
          {
            key: 'view',
            label: 'View Details',
            icon: <Icons.Search size={14} strokeWidth={2} />,
            onSelect: () => setDetailsUser(user),
          },
          {
            key: 'edit',
            label: 'Edit User',
            icon: <Icons.Edit size={14} strokeWidth={2} />,
            onSelect: () => setEditing(user),
          },
          {
            key: 'activity',
            label: 'View Activity',
            icon: <Icons.ScrollText size={14} strokeWidth={2} />,
            onSelect: () => setActivityUser(user),
          },
          {
            key: 'reset',
            label: 'Reset Password',
            icon: <Icons.Mail size={14} strokeWidth={2} />,
            onSelect: () => openConfirm('password-reset', user),
          },
          // Independently enforced by the backend: role:badac_admin on the
          // route, and UserController::issueTemporaryPassword refuses your own
          // account and inactive accounts with a 422.
          {
            key: 'temporary-password',
            label: 'Reissue Temporary Password',
            icon: <Icons.Lock size={14} strokeWidth={2} />,
            disabled: isSelf || !user.isActive,
            title: isSelf
              ? 'You cannot issue a temporary password to your own account'
              : !user.isActive
                ? 'Activate this account first'
                : undefined,
            onSelect: () => setReissueUser(user),
          },
          // One slot, by account state. Requiring is NOT enrolling: it sets a
          // flag on the Supabase identity and nothing else — the account
          // holder still scans their own QR code, and no administrator ever
          // sees the secret. See UserController::requireTwoFactor.
          //
          // Authenticator App accounts (every account not on email OTP) can
          // never be left without MFA, and the backend enforces that:
          //   enrolled            -> Reset Authenticator (re-enrolment required)
          //   pending enrolment   -> nothing to do; no cancel is offered
          //   neither (older acct) -> Require 2FA
          // Email OTP accounts keep their existing actions, because the emailed
          // code stays mandatory whatever happens to the authenticator.
          ...(user.twoFactorEnabled
            ? [
                {
                  key: 'two-factor',
                  label: usesAuthenticatorAppMfa(user)
                    ? 'Reset Authenticator'
                    : 'Clear 2FA',
                  icon: <Icons.ShieldCheck size={14} strokeWidth={2} />,
                  onSelect: () => openConfirm('two-factor', user),
                },
              ]
            : user.mfaRequiredByAdmin
              ? usesEmailOtpMfa(user)
                ? [
                    {
                      key: 'two-factor-cancel',
                      label: 'Cancel 2FA Requirement',
                      icon: <Icons.ShieldCheck size={14} strokeWidth={2} />,
                      onSelect: () => openConfirm('two-factor-cancel', user),
                    },
                  ]
                : []
              : [
                  {
                    key: 'two-factor-require',
                    label: 'Require 2FA',
                    icon: <Icons.ShieldCheck size={14} strokeWidth={2} />,
                    onSelect: () => openConfirm('two-factor-require', user),
                  },
                ]),
          {
            key: 'status',
            separatorBefore: true,
            danger: user.isActive,
            label: user.isActive ? 'Deactivate User' : 'Activate User',
            icon: <Icons.Lock size={14} strokeWidth={2} />,
            // Preserved from the previous version, and independently
            // enforced by the backend (UserController::updateStatus returns
            // 422 for a self-deactivation regardless of what the UI allows).
            disabled: user.isActive && isSelf,
            title:
              user.isActive && isSelf
                ? 'You cannot deactivate your own account'
                : undefined,
            onSelect: () => openConfirm('status', user),
          },
        ])}
      />
    );
  };

  return (
    <section className="module">
      <div className="module-toolbar">
        <div>
          <h2 className="module-title">
            <Icons.Users size={18} strokeWidth={2} /> User Management
          </h2>
          <p className="module-subtitle">
            Manage system accounts, roles, access, and security
          </p>
        </div>
        <div className="toolbar-actions">
          <Button onClick={() => setCreating(true)}>
            <Icons.Plus size={15} strokeWidth={2} /> Add User
          </Button>
        </div>
      </div>

      {loading ? (
        // The visible text is already the right message; role="status" is what
        // makes it reach a screen reader when it appears.
        <div className="empty-state" style={{ padding: 60 }} role="status">
          <div className="spinner" aria-hidden="true" />
          <p style={{ color: 'var(--text-muted)' }}>Loading users…</p>
        </div>
      ) : loadError ? (
        <Card>
          <div className="empty-state" style={{ padding: 40 }}>
            <p style={{ color: 'var(--text-muted)' }}>{loadError}</p>
            <Button variant="secondary" onClick={load}>
              <Icons.Sync size={14} strokeWidth={2} /> Try again
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <UserStatsCards users={users} />

          <div className="filters-bar">
            <div className="filter-group filter-group-grow">
              <label htmlFor="user-search">Search</label>
              <input
                id="user-search"
                type="search"
                placeholder="Search users…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="filter-group">
              <label htmlFor="user-role-filter">Role</label>
              <select
                id="user-role-filter"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              >
                <option value="">All Roles</option>
                {ROLE_OPTIONS.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label htmlFor="user-status-filter">Status</label>
              <select
                id="user-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="filter-group">
              <label htmlFor="user-2fa-filter">2FA</label>
              <select
                id="user-2fa-filter"
                value={twoFactorFilter}
                onChange={(e) => setTwoFactorFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="enabled">Enrolled</option>
                <option value="disabled">Not enrolled</option>
              </select>
            </div>
          </div>

          <Card bodyClassName="table-wrap">
            <Table
              className="user-account-table"
              columns={[
                {
                  key: 'fullName',
                  label: 'Name',
                  render: (value, row) => (
                    <div className="user-name-cell">
                      <span className="user-name-cell-primary">{value}</span>
                      <span className="user-name-cell-secondary">
                        {row.username}
                      </span>
                    </div>
                  ),
                },
                { key: 'roleLabel', label: 'Role' },
                {
                  key: 'isActive',
                  label: 'Status',
                  // The temporary-credential badge is a STATE only
                  // (pending/expired, from the administrator-only
                  // temporaryCredentialStatus field). No password is ever
                  // available to this list.
                  render: (v, row) => (
                    <div className="user-status-cell">
                      <Badge status={v ? 'Active' : 'Inactive'} />
                      {temporaryCredentialLabel(row) && (
                        <Badge status={temporaryCredentialLabel(row)} />
                      )}
                    </div>
                  ),
                },
                {
                  key: 'twoFactorEnabled',
                  label: '2FA',
                  // Reads the whole row, not just twoFactorEnabled: an
                  // email_otp account has no Supabase factor yet is required
                  // to enter an emailed code, and must not be badged
                  // "Not enrolled". See src/utils/mfaStatus.js.
                  render: (_v, row) => <Badge status={mfaStatusLabel(row)} />,
                },
                {
                  key: 'lastLoginAt',
                  label: 'Last Login',
                  // "Never" is a fact about the account, not a placeholder:
                  // it means the audit trail holds no LOGIN row for it.
                  render: (v) => formatDateTime(v) ?? 'Never',
                },
              ]}
              rows={filtered}
              actions={rowMenu}
              emptyMessage={
                filtersApplied
                  ? 'No users match your search.'
                  : 'No users found.'
              }
            />
          </Card>

          <SecuritySummary users={users} />
          <RolePermissionsCard />
        </>
      )}

      {/* Self-service 2FA for the signed-in administrator's own account.
          Distinct from "Manage 2FA" in a row, which acts on ANOTHER account
          via POST /users/{user}/two-factor/disable — that action is
          unchanged. */}
      <TwoFactorSelfService />

      <UserDetailsModal
        open={Boolean(detailsUser)}
        user={detailsUser}
        currentUser={currentUser}
        onClose={() => setDetailsUser(null)}
      />

      <UserActivityModal
        open={Boolean(activityUser)}
        user={activityUser}
        onClose={() => setActivityUser(null)}
      />

      <EditUserModal
        open={Boolean(editing)}
        user={editing}
        saving={saving}
        onClose={() => setEditing(null)}
        onSave={handleSaveEdit}
      />

      <CreateUserModal
        open={creating}
        saving={saving}
        onClose={() => setCreating(false)}
        onCreate={handleCreate}
        onNotice={showToast}
        roleOptions={assignableRoleOptions(currentUser?.role)}
      />

      <ReissueTemporaryPasswordModal
        user={reissueUser}
        onClose={() => setReissueUser(null)}
        onNotice={showToast}
        onIssued={(updated, password) => {
          replaceUser(updated);
          setReissueUser(null);
          setOneTimeCredential({
            password,
            expiresAt: updated.temporaryCredentialExpiresAt,
            accountName: updated.fullName,
            reissued: true,
          });
          showToast(`Temporary password reissued for ${updated.fullName}.`, 'success');
        }}
      />

      <OneTimeCredentialModal
        credential={oneTimeCredential}
        onClose={() => setOneTimeCredential(null)}
        onNotice={showToast}
      />

      <ConfirmActionModal
        open={confirm?.type === 'status'}
        title={
          confirm?.user?.isActive ? 'Deactivate Account' : 'Activate Account'
        }
        confirmLabel={confirm?.user?.isActive ? 'Deactivate' : 'Activate'}
        busyLabel={confirm?.user?.isActive ? 'Deactivating…' : 'Activating…'}
        variant={confirm?.user?.isActive ? 'danger' : 'primary'}
        busy={confirmBusy}
        error={confirmError}
        onConfirm={runConfirm}
        onClose={closeConfirm}
      >
        <p className="confirm-lead">
          You are about to{' '}
          {confirm?.user?.isActive ? 'deactivate' : 'reactivate'}:
        </p>
        <div className="confirm-subject">
          <strong>{confirm?.user?.fullName}</strong>
          <span>Username: {confirm?.user?.username}</span>
          <span>Role: {confirm?.user?.roleLabel}</span>
        </div>
        {confirm?.user?.isActive ? (
          <p className="confirm-note">
            This user will no longer be able to sign in. Existing crime records
            and audit history are <strong>not</strong> deleted — the account is
            disabled, never removed.
          </p>
        ) : (
          <p className="confirm-note">
            This user will be able to sign in again with their existing Supabase
            credentials.
          </p>
        )}
      </ConfirmActionModal>

      <ConfirmActionModal
        open={confirm?.type === 'password-reset'}
        title="Reset Password"
        confirmLabel="Send Reset Link"
        busyLabel="Sending…"
        busy={confirmBusy}
        error={confirmError}
        onConfirm={runConfirm}
        onClose={closeConfirm}
      >
        <p className="confirm-lead">Send password reset instructions to:</p>
        <div className="confirm-subject">
          <strong>{confirm?.user?.email}</strong>
          <span>{confirm?.user?.fullName}</span>
        </div>
        <p className="confirm-note">
          Supabase sends the email and the person sets their own password. No
          password is created, viewed, or stored by this system, and nothing
          about the account changes until they complete the reset.
        </p>
      </ConfirmActionModal>

      <ConfirmActionModal
        open={confirm?.type === 'two-factor-require'}
        title="Require Two-Factor Authentication"
        confirmLabel="Require 2FA"
        busyLabel="Applying…"
        busy={confirmBusy}
        error={confirmError}
        onConfirm={runConfirm}
        onClose={closeConfirm}
      >
        <p className="confirm-lead">
          Require an authenticator app at every sign-in for:
        </p>
        <div className="confirm-subject">
          <strong>{confirm?.user?.fullName}</strong>
          <span>Username: {confirm?.user?.username}</span>
        </div>
        <p className="confirm-note">
          They will be asked to set up an authenticator the next time they sign
          in, and cannot reach any part of the system until they have. They scan
          the QR code themselves on their own device — you will never see their
          secret, their QR code, or any code it produces, and this does not let
          you sign in as them.
        </p>
      </ConfirmActionModal>

      <ConfirmActionModal
        open={confirm?.type === 'two-factor-cancel'}
        title="Cancel Two-Factor Requirement"
        confirmLabel="Cancel Requirement"
        busyLabel="Applying…"
        variant="danger"
        busy={confirmBusy}
        error={confirmError}
        onConfirm={runConfirm}
        onClose={closeConfirm}
      >
        <p className="confirm-lead">Stop requiring an authenticator app for:</p>
        <div className="confirm-subject">
          <strong>{confirm?.user?.fullName}</strong>
          <span>Username: {confirm?.user?.username}</span>
        </div>
        {/* The generic wording promises sign-in with a password alone, which
            is true only when the authenticator requirement is the account's
            only second factor. An email_otp account keeps its emailed-code
            requirement regardless — that follows users.mfa_method, which this
            action does not touch. */}
        {usesEmailOtpMfa(confirm?.user) ? (
          <p className="confirm-note">
            This account signs in with an emailed one-time code, and that stays
            required — cancelling here only lifts the separate authenticator-app
            requirement. It does not let them sign in with their password alone.
          </p>
        ) : (
          <p className="confirm-note">
            The authenticator requirement cannot be cancelled for an
            Authenticator App account, because it would leave the account with
            no two-factor authentication. The request will be refused.
          </p>
        )}
      </ConfirmActionModal>

      <ConfirmActionModal
        open={confirm?.type === 'two-factor'}
        title={
          usesAuthenticatorAppMfa(confirm?.user)
            ? 'Reset Authenticator'
            : 'Clear Two-Factor Authentication'
        }
        confirmLabel={
          usesAuthenticatorAppMfa(confirm?.user)
            ? 'Reset Authenticator'
            : 'Clear Factor'
        }
        busyLabel={
          usesAuthenticatorAppMfa(confirm?.user) ? 'Resetting…' : 'Clearing…'
        }
        variant="danger"
        busy={confirmBusy}
        error={confirmError}
        onConfirm={runConfirm}
        onClose={closeConfirm}
      >
        <p className="confirm-lead">
          Remove the enrolled authenticator factor for:
        </p>
        <div className="confirm-subject">
          <strong>{confirm?.user?.fullName}</strong>
          <span>Username: {confirm?.user?.username}</span>
        </div>
        {usesAuthenticatorAppMfa(confirm?.user) ? (
          <p className="confirm-note">
            This is the recovery path for someone who has lost their
            authenticator device. Two-factor authentication stays required:
            at their next sign-in they must set up a new authenticator app
            before they can use the system. No secret or recovery code is ever
            displayed.
          </p>
        ) : (
          <p className="confirm-note">
            This is the recovery path for someone who has lost their
            authenticator device. Removing the authenticator does not remove
            email verification — a one-time code is still emailed at every
            sign-in. No secret or recovery code is ever displayed.
          </p>
        )}
      </ConfirmActionModal>
    </section>
  );
}
