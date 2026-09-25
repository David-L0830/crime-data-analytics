import { describe, expect, it } from 'vitest';
import {
  MANAGEABLE_ROLES,
  PERMISSIONS,
  ROLES,
  canManageAccount,
  defaultRouteForRole,
} from './constants';
import { assignableRoleOptions } from '../components/users/userValidation';

/**
 * System Governance (Super Administrator) vs Operational Governance
 * (Administrator) — the frontend half.
 *
 * None of this is a security control: the backend's role: middleware,
 * StoreUserRequest and 'manage-account' Gate enforce the same split
 * (tests/Feature/GovernanceRolesTest.php). These maps decide what the UI
 * offers, and they must not offer anything the API would refuse.
 */

const ALL_ROLES = ['super_admin', 'badac_admin', 'encoder', 'badac_validator'];

const RECORD_ACTIONS = [
  'create_incident',
  'edit_any_record',
  'edit_own_incident',
  'archive_record',
  'archive_own_incident',
  'validate_record',
];

describe('Super Administrator — System Governance', () => {
  it('owns System Settings, the audit trail and User Management', () => {
    expect(ROLES.super_admin.modules).toEqual(
      expect.arrayContaining(['settings', 'audit-logs', 'user-management']),
    );
  });

  it('can view every operational and analytics module', () => {
    expect(ROLES.super_admin.modules).toEqual(
      expect.arrayContaining([
        'dashboard',
        'incident-feed',
        'mapping',
        'analytics',
        'trends',
        'criminal-records',
      ]),
    );
  });

  it('holds no record action, so every operational page is read-only', () => {
    for (const action of RECORD_ACTIONS) {
      expect(PERMISSIONS.super_admin).not.toContain(action);
    }
  });

  it('lands on the dashboard after sign-in', () => {
    expect(defaultRouteForRole('super_admin')).toBe('/dashboard');
  });
});

describe('Administrator — Operational Governance', () => {
  it('no longer reaches System Settings or the audit trail', () => {
    expect(ROLES.badac_admin.modules).not.toContain('settings');
    expect(ROLES.badac_admin.modules).not.toContain('audit-logs');
    expect(PERMISSIONS.badac_admin).not.toContain('view_audit_logs');
    expect(PERMISSIONS.badac_admin).not.toContain('manage_settings');
  });

  it('keeps operational editing, validation and User Management', () => {
    expect(PERMISSIONS.badac_admin).toEqual(
      expect.arrayContaining(['edit_any_record', 'archive_record', 'validate_record']),
    );
    expect(ROLES.badac_admin.modules).toContain('user-management');
  });
});

describe('account governance', () => {
  it('each tier manages only the tier below it', () => {
    expect(canManageAccount('super_admin', 'badac_admin')).toBe(true);
    expect(canManageAccount('super_admin', 'encoder')).toBe(false);
    expect(canManageAccount('super_admin', 'badac_validator')).toBe(false);

    expect(canManageAccount('badac_admin', 'encoder')).toBe(true);
    expect(canManageAccount('badac_admin', 'badac_validator')).toBe(true);
    expect(canManageAccount('badac_admin', 'badac_admin')).toBe(false);

    expect(canManageAccount('encoder', 'encoder')).toBe(false);
    expect(canManageAccount('badac_validator', 'encoder')).toBe(false);
  });

  it('nobody can manage or assign a Super Administrator', () => {
    for (const viewer of ALL_ROLES) {
      expect(canManageAccount(viewer, 'super_admin')).toBe(false);
      expect(assignableRoleOptions(viewer).map((o) => o.value)).not.toContain(
        'super_admin',
      );
    }
    for (const list of Object.values(MANAGEABLE_ROLES)) {
      expect(list).not.toContain('super_admin');
    }
  });

  it('offers each viewer exactly the roles the backend lets it assign', () => {
    expect(assignableRoleOptions('badac_admin').map((o) => o.value)).toEqual([
      'badac_validator',
      'encoder',
    ]);
    expect(assignableRoleOptions('super_admin').map((o) => o.value)).toEqual([
      'badac_admin',
    ]);
    expect(assignableRoleOptions('encoder')).toEqual([]);
    expect(assignableRoleOptions('badac_validator')).toEqual([]);
  });
});
