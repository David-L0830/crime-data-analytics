import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { userService } from '../services/userService';
import { ApiError } from '../services/api';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import { Icons } from '../components/icons';
import TwoFactorSelfService from '../components/settings/TwoFactorSelfService';

// Phase 4 — Admin User Management. Route-gated to badac_admin in
// AppRoutes.jsx/constants.js; the backend enforces the same restriction
// independently (role:badac_admin middleware), so the account table below
// can only ever be reached — and its API calls only ever succeed — for the
// BADAC Administrator account.
//
// Checkpoint 28 — this page is now also reachable by the Encoder role
// (see ROLES.encoder.modules in constants.js), because Two-Factor
// Authentication moved here from the old standalone Security page. Encoder
// never had — and still doesn't have — access to the admin account table
// or any /users* endpoint (those stay role:badac_admin-only on the
// backend); this page simply renders only the self-service 2FA section for
// any non-admin role, and skips the admin-only userService.list() call
// entirely so no unauthorized request is even attempted.
export default function UserManagement() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const isAdmin = currentUser?.role === 'badac_admin';

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(isAdmin);
  const [editing, setEditing] = useState(null); // user being edited, or null
  const [form, setForm] = useState({ fullName: '', username: '', email: '' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    if (!isAdmin) return;
    setLoading(true);
    userService
      .list()
      .then(setUsers)
      .catch((err) =>
        showToast(
          err instanceof ApiError ? err.message : 'Could not load users.',
          'error',
        ),
      )
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openEdit = (user) => {
    setEditing(user);
    setForm({
      fullName: user.fullName,
      username: user.username,
      email: user.email,
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const updated = await userService.update(editing.id, form);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      showToast('Account updated.', 'success');
      setEditing(null);
    } catch (err) {
      showToast(
        err instanceof ApiError
          ? err.errors
            ? Object.values(err.errors).flat().join(' ')
            : err.message
          : 'Could not update account.',
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (user) => {
    const next = !user.isActive;
    if (
      !window.confirm(
        `${next ? 'Activate' : 'Deactivate'} ${user.fullName}'s account?`,
      )
    )
      return;

    try {
      const updated = await userService.setActive(user.id, next);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      showToast(`Account ${next ? 'activated' : 'deactivated'}.`, 'success');
    } catch (err) {
      showToast(
        err instanceof ApiError
          ? err.message
          : 'Could not update account status.',
        'error',
      );
    }
  };

  const disableUserTwoFactor = async (user) => {
    if (
      !window.confirm(
        `Disable two-factor authentication for ${user.fullName}? They will need to set it up again.`,
      )
    )
      return;
    try {
      const updated = await userService.disableTwoFactor(user.id);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      showToast('Two-factor authentication disabled.', 'success');
    } catch (err) {
      showToast(
        err instanceof ApiError
          ? err.message
          : 'Could not disable two-factor authentication.',
        'error',
      );
    }
  };

  // Non-admin (Encoder): just the self-service 2FA section that used to
  // live on the standalone Security page — no admin table, no
  // admin-only API calls.
  if (!isAdmin) {
    return (
      <section className="module">
        <div className="module-toolbar">
          <h2
            style={{
              fontSize: '1.1rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Icons.Users size={18} strokeWidth={2} /> User Management
          </h2>
        </div>
        <TwoFactorSelfService />
      </section>
    );
  }

  if (loading) {
    return (
      <div className="empty-state" style={{ padding: 60 }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <section className="module">
      <div className="module-toolbar">
        <h2
          style={{
            fontSize: '1.1rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Icons.Users size={18} strokeWidth={2} /> User Management
        </h2>
      </div>

      <Card bodyClassName="table-wrap">
        <Table
          columns={[
            { key: 'fullName', label: 'Name' },
            { key: 'username', label: 'Username' },
            { key: 'email', label: 'Email' },
            { key: 'roleLabel', label: 'Role' },
            {
              key: 'isActive',
              label: 'Status',
              render: (v) => <Badge status={v ? 'Active' : 'Inactive'} />,
            },
            {
              key: 'twoFactorEnabled',
              label: '2FA',
              render: (v) => <Badge status={v ? 'Active' : 'Inactive'} />,
            },
          ]}
          rows={users}
          actions={(user) => (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => openEdit(user)}
              >
                <Icons.Edit size={14} strokeWidth={2} /> Edit
              </Button>
              <Button
                size="sm"
                variant={user.isActive ? 'danger' : 'secondary'}
                disabled={user.id === currentUser?.id}
                title={
                  user.id === currentUser?.id
                    ? 'You cannot deactivate your own account'
                    : undefined
                }
                onClick={() => toggleActive(user)}
              >
                {user.isActive ? 'Deactivate' : 'Activate'}
              </Button>
              {user.twoFactorEnabled && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => disableUserTwoFactor(user)}
                >
                  Disable 2FA
                </Button>
              )}
            </div>
          )}
        />
      </Card>

      {/* Checkpoint 28 — self-service 2FA for the signed-in admin's own
          account (moved from the old Security page). This is distinct
          from "Disable 2FA" in the table above, which is the admin acting
          on ANOTHER user's account via POST /users/{user}/two-factor/disable
          — that action is untouched and stays in the table row above. */}
      <TwoFactorSelfService />

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.fullName}` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </>
        }
      >
        <div className="form-group">
          <label>Full Name</label>
          <input
            type="text"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label>Username</label>
          <input
            type="text"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label>Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        {(editing?.role === 'encoder' ||
          editing?.role === 'badac_readonly') && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            Role changes aren't supported from this screen.
          </p>
        )}
      </Modal>
    </section>
  );
}
