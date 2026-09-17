import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ROLES,
  NAV_ITEMS,
  NAV_SECTION_LABELS,
  PAGE_TITLES,
  PERMISSIONS,
  VALIDATION_STATUS_LABELS,
} from '../utils/constants';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, ...p), 'utf8');

/**
 * Reports: its own REPORTING section at /reports (the old /scheduled-reports
 * redirects), managed by the BADAC Administrator and viewable by BADAC
 * Read-Only, with archive/restore instead of delete.
 *
 * Source-level guards in the style of the other page tests here (the Vitest
 * environment is node, with no DOM). The server-side authorization and the
 * recipient-privacy rules these mirror are covered by
 * backend/tests/Feature/ScheduledReportTest.php.
 */
const page = read('ScheduledReports.jsx');
const routes = read('..', 'routes', 'AppRoutes.jsx');
const service = read('..', 'services', 'reportScheduleService.js');

// The page with comments removed, so assertions are about code and visible
// text rather than about explanations.
const pageCode = page
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('Reports module — navigation and routing', () => {
  it('is "Reports" in its own REPORTING section, and the old entry is gone', () => {
    const item = NAV_ITEMS.find((i) => i.id === 'reports');
    expect(item).toMatchObject({ label: 'Reports', section: 'reporting' });
    expect(NAV_SECTION_LABELS.reporting).toBe('Reporting');
    expect(PAGE_TITLES.reports).toBe('Reports');

    expect(NAV_ITEMS.find((i) => i.id === 'scheduled-reports')).toBeUndefined();
    expect(NAV_ITEMS.some((i) => /Scheduled Report/i.test(i.label))).toBe(false);
    expect(PAGE_TITLES['scheduled-reports']).toBeUndefined();
  });

  it('sits after Analytics and before Administration, which keeps its own items', () => {
    const sections = NAV_ITEMS.map((i) => i.section);
    const reportsAt = NAV_ITEMS.findIndex((i) => i.id === 'reports');
    expect(sections.lastIndexOf('analytics')).toBeLessThan(reportsAt);
    expect(sections.indexOf('administration')).toBeGreaterThan(reportsAt);

    for (const id of ['user-management', 'settings']) {
      expect(NAV_ITEMS.find((i) => i.id === id).section).toBe('administration');
    }
  });

  it('is granted to the Administrator and Read-Only, never to the Encoder', () => {
    expect(ROLES.badac_admin.modules).toContain('reports');
    expect(ROLES.badac_readonly.modules).toContain('reports');
    expect(ROLES.encoder.modules).not.toContain('reports');
    for (const role of Object.values(ROLES)) {
      expect(role.modules).not.toContain('scheduled-reports');
    }
  });

  it('uses /reports as the guarded route and redirects the legacy URL', () => {
    expect(routes).toContain(`path="/reports" element={guarded('reports', ScheduledReports)}`);
    const legacy = routes.slice(routes.indexOf('path="/scheduled-reports"'));
    expect(routes).toContain('path="/scheduled-reports"');
    expect(legacy.slice(0, 120)).toContain('<Navigate to="/reports" replace />');
    expect(routes).not.toContain("guarded('scheduled-reports'");
  });

  it('is no longer rendered inside System Settings', () => {
    const settings = read('Settings.jsx');
    expect(settings).not.toContain('ScheduledReportsSection');
    expect(
      existsSync(join(here, '..', 'components', 'settings', 'ScheduledReportsSection.jsx')),
    ).toBe(false);
  });
});

describe('Reports module — management is Administrator-only', () => {
  it('grants manage_reports to the Administrator alone', () => {
    expect(PERMISSIONS.badac_admin).toContain('manage_reports');
    expect(PERMISSIONS.badac_readonly).not.toContain('manage_reports');
    expect(PERMISSIONS.encoder).not.toContain('manage_reports');
  });

  it('renders every mutation control only behind manage_reports', () => {
    expect(pageCode).toContain("const canManage = can('manage_reports');");

    // Create (both places), the row actions, the form and the dialogs.
    expect(pageCode.match(/\{canManage && \(/g)?.length).toBeGreaterThanOrEqual(3);
    const actionsAt = pageCode.indexOf('actions={');
    expect(pageCode.slice(actionsAt, actionsAt + 60)).toContain('canManage');

    const formAt = pageCode.indexOf('<ScheduleFormModal');
    const gateBeforeForm = pageCode.lastIndexOf('{canManage && (', formAt);
    expect(gateBeforeForm).toBeGreaterThan(-1);
    expect(formAt - gateBeforeForm).toBeLessThan(80);
  });

  it('keeps list, logs, create, update, run and adds archive and restore', () => {
    for (const call of [
      'reportScheduleService.list(',
      'reportScheduleService.logs()',
      'reportScheduleService.create(',
      'reportScheduleService.update(',
      'reportScheduleService.archive(',
      'reportScheduleService.restore(',
      'reportScheduleService.run(',
    ]) {
      expect(page).toContain(call);
    }
    expect(page).toContain('Create Report Schedule');
    expect(page).toMatch(/Loading\s+report schedules/);
    expect(page).toContain('Report schedules could not be loaded.');
    expect(page).toContain('No report schedules yet');
    expect(page).toContain("'Edit Report Schedule'");
    // Outward-facing and state-changing actions are confirmed first.
    expect(page).toContain('Archive report schedule?');
    expect(page).toContain('Restore report schedule?');
    expect(page).toContain('Send this report now?');
  });

  it('does not offer Run now for a paused schedule, which the server refuses', () => {
    const runAt = pageCode.indexOf("setConfirm({ type: 'run', schedule: row })");
    expect(runAt).toBeGreaterThan(-1);
    expect(pageCode.slice(runAt - 300, runAt)).toContain(
      'disabled={busyId === row.id || !row.isActive}',
    );
  });

  it('offers an Active / Archived view', () => {
    expect(pageCode).toContain("setView('active')");
    expect(pageCode).toContain("setView('archived')");
    expect(pageCode).toContain('reportScheduleService.list({ archived: showingArchived })');
    expect(service).toContain("'/report-schedules?archived=1'");
  });
});

describe('Reports module — terminology', () => {
  it('calls the module "Reports" and each configuration a "Report Schedule"', () => {
    // Comments are stripped: this is about what a person reads on screen.
    expect(pageCode).not.toMatch(/scheduled report/i);
  });
});

describe('Reports module — there is no permanent delete', () => {
  it('has no Delete button, dialog, handler or service call', () => {
    // Whole word: the archive dialog may reassure that "Nothing is deleted".
    expect(pageCode).not.toMatch(/\bdelete\b/i);
    expect(pageCode).not.toContain('handleDelete');
    expect(pageCode).not.toContain('Icons.Delete');
    expect(pageCode).not.toContain('reportScheduleService.remove');
    expect(service).not.toMatch(/api\.delete|remove:/);
  });
});

describe('Reports module — recipient privacy in the UI', () => {
  it('reads recipient addresses and errors only when the server sent them', () => {
    // A Read-Only response has recipientCount and no recipients/error keys;
    // the page must render from the count, not assume the array exists.
    expect(pageCode).toContain('recipientCountLabel(count)');
    expect(pageCode).toContain('Array.isArray(row.recipients)');
    expect(pageCode).toContain('row.error ?');
    expect(pageCode).not.toContain('result.log.recipients.length');
    expect(pageCode).not.toContain('confirming.recipients?.length');
  });
});

describe('record validation permissions and vocabulary', () => {
  it('only the Administrator may validate records in the UI', () => {
    expect(PERMISSIONS.badac_admin).toContain('validate_record');
    expect(PERMISSIONS.encoder).not.toContain('validate_record');
    expect(PERMISSIONS.badac_readonly).not.toContain('validate_record');
  });

  it('labels the three validation states', () => {
    expect(VALIDATION_STATUS_LABELS).toEqual({
      pending: 'Pending Validation',
      validated: 'Validated',
      returned: 'Returned for Correction',
    });
  });
});
