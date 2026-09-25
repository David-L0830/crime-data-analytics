import { Link } from 'react-router-dom';
import Card from '../ui/Card';
import { Icons } from '../icons';
import {
  MANAGEABLE_ROLES,
  NAV_ITEMS,
  PERMISSIONS,
  ROLES,
} from '../../utils/constants';

// System Governance — System Settings (Super Administrator).
//
// A read-only view of the role configuration the interface applies, rendered
// straight from ROLES, PERMISSIONS and MANAGEABLE_ROLES so it cannot drift
// from what the app actually does. It changes nothing: roles are enforced
// server-side by the role: middleware in backend/routes/api.php.
const moduleLabel = (id) => NAV_ITEMS.find((n) => n.id === id)?.label ?? id;

const permissionLabel = (key) => {
  const text = key.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export default function GovernancePanel() {
  return (
    <div className="governance">
      <Card
        title="Role Access Overview"
        actions={
          <div className="toolbar-actions">
            <Link className="btn btn-secondary btn-sm" to="/audit-logs">
              <Icons.ScrollText size={14} strokeWidth={2} /> Audit Logs
            </Link>
            <Link className="btn btn-secondary btn-sm" to="/user-management">
              <Icons.Users size={14} strokeWidth={2} /> User Management
            </Link>
          </div>
        }
      >
        <p className="settings-note">
          The modules, record actions and account management each role is given
          in this interface. The server enforces the same rules independently
          on every request, so this view is informational and changes nothing.
        </p>
        <div className="table-wrap">
          <table className="governance-table">
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">Modules</th>
                <th scope="col">Record actions</th>
                <th scope="col">Manages accounts</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(ROLES).map(([key, role]) => (
                <tr key={key}>
                  <th scope="row">{role.label}</th>
                  <td>{role.modules.map(moduleLabel).join(', ')}</td>
                  <td>
                    {(PERMISSIONS[key] ?? []).map(permissionLabel).join(', ') ||
                      'View only'}
                  </td>
                  <td>
                    {(MANAGEABLE_ROLES[key] ?? [])
                      .map((r) => ROLES[r]?.label ?? r)
                      .join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
