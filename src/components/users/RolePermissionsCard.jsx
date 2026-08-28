import { useState } from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { rolePermissionService } from '../../services/rolePermissionService';
import { ApiError } from '../../services/api';
import { Icons } from '../icons';

// Role Permissions.
//
// The matrix is fetched, never written here. Its source is the Laravel route
// table itself: the backend walks its registered routes, reads the `role:`
// (EnsureRole) middleware actually attached to each one, and reports what it
// finds (see App\Http\Controllers\Api\RolePermissionController). So this is a
// window onto the enforcement, not a second description of it that could
// disagree with it.
//
// Loaded on demand rather than with the page, because it is reference
// material an administrator opens occasionally, not something the account
// table depends on.
const SYMBOLS = {
  full: { mark: '✓', label: 'Full access', cls: 'perm-full' },
  view: { mark: 'View', label: 'View only', cls: 'perm-view' },
  none: { mark: '✗', label: 'No access', cls: 'perm-none' },
};

export default function RolePermissionsCard() {
  const [matrix, setMatrix] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (matrix) return;

    setLoading(true);
    setError('');
    try {
      setMatrix(await rolePermissionService.list());
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Unable to load role permissions. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      title="Role Permissions"
      actions={
        <Button size="sm" variant="secondary" onClick={toggle}>
          <Icons.Lock size={14} strokeWidth={2} />
          {open ? 'Hide' : 'View Role Permissions'}
        </Button>
      }
    >
      {!open ? (
        <p className="role-perm-intro">
          Shows which roles the API actually admits to each module, read
          directly from the route authorization rules.
        </p>
      ) : loading ? (
        <div className="empty-state" style={{ padding: 32 }}>
          <div className="spinner" />
        </div>
      ) : error ? (
        <div className="login-error">{error}</div>
      ) : matrix ? (
        <>
          <div className="table-wrap">
            <table className="role-perm-table">
              <thead>
                <tr>
                  <th>Module</th>
                  {matrix.roles.map((role) => (
                    <th key={role.key}>{role.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.modules.map((module) => (
                  <tr key={module.id}>
                    <td>{module.label}</td>
                    {matrix.roles.map((role) => {
                      const symbol =
                        SYMBOLS[module.access[role.key]] ?? SYMBOLS.none;
                      return (
                        <td key={role.key}>
                          <span
                            className={`perm-cell ${symbol.cls}`}
                            title={`${symbol.label} — derived from: ${module.endpoints.join(', ')}`}
                          >
                            {symbol.mark}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="role-perm-note">
            Derived from the API’s own route authorization rules. This view
            grants nothing — the server decides every request independently, and
            remains the only authority on access.
          </p>
        </>
      ) : null}
    </Card>
  );
}
