import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { userService } from '../services/userService';
import { ApiError } from '../services/api';
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
import EditUserModal from '../components/users/EditUserModal';
import ConfirmActionModal from '../components/users/ConfirmActionModal';
import SecuritySummary from '../components/users/SecuritySummary';
import RolePermissionsCard from '../components/users/RolePermissionsCard';
import {
  ROLE_OPTIONS,
  describeApiFailure,
} from '../components/users/userValidation';
import { formatDateTime } from '../utils/helpers';

// Account Administration & Security Center (formerly the plain User
// Management table).
//
// The security model is unchanged and is deliberately not re-implemented
// here. This page is route-gated to roles that have the 'user-management'
// module (see ROLES in constants.js and ProtectedRoute), and the backend
// enforces the real boundary independently: every /users* endpoint and
// /role-permissions sits behind `role:badac_admin` middleware, so an Encoder
// or BADAC account calling them directly gets a 403 before any controller
// runs. Nothing below is a security control — the admin-only sections simply
// are not rendered for a non-admin, and no admin-only request is even
// attempted for them.
//
// Encoder reaches this route only for the self-service 2FA panel that moved
// here from the old Security page (Checkpoint 28); that branch is untouched.
export default function UserManagement() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const isAdmin = currentUser?.role === 'badac_admin';

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(isAdmin);
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

  const load = () => {
    if (!isAdmin) return;
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
      if (twoFactorFilter === 'enabled' && !user.twoFactorEnabled) return false;
      if (twoFactorFilter === 'disabled' && user.twoFactorEnabled) return false;
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
          'Two-factor authentication cleared for this account.',
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

  // Non-admin (Encoder): the self-service 2FA section only — no account
  // table, no admin-only request attempted.
  if (!isAdmin) {
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

  const rowMenu = (user) => {
    const isSelf = user.id === currentUser?.id;
    return (
      <UserRowMenu
        label={`Actions for ${user.fullName}`}
        items={[
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
          {
            key: 'two-factor',
            label: 'Manage 2FA',
            icon: <Icons.ShieldCheck size={14} strokeWidth={2} />,
            disabled: !user.twoFactorEnabled,
            title: user.twoFactorEnabled
              ? undefined
              : 'This account has no enrolled factor to clear. Enrolment is done by the account holder.',
            onSelect: () => openConfirm('two-factor', user),
          },
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
        ]}
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
        <div className="empty-state" style={{ padding: 60 }}>
          <div className="spinner" />
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
                  render: (v) => <Badge status={v ? 'Active' : 'Inactive'} />,
                },
                {
                  key: 'twoFactorEnabled',
                  label: '2FA',
                  render: (v) => (
                    <Badge status={v ? 'Enrolled' : 'Not enrolled'} />
                  ),
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
        open={confirm?.type === 'two-factor'}
        title="Clear Two-Factor Authentication"
        confirmLabel="Clear Factor"
        busyLabel="Clearing…"
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
        <p className="confirm-note">
          This is the recovery path for someone who has lost their authenticator
          device. They will be able to sign in without a code and can enrol a
          new factor themselves. No secret or recovery code is ever displayed.
        </p>
      </ConfirmActionModal>
    </section>
  );
}
