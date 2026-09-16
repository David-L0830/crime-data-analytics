import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ROLES,
  NAV_ITEMS,
  PAGE_TITLES,
  PERMISSIONS,
  VALIDATION_STATUS_LABELS,
} from '../utils/constants';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, ...p), 'utf8');

/**
 * Scheduled Reports is its own module, visible to the BADAC Administrator
 * only, and no longer a section of System Settings.
 *
 * Source-level guards in the style of the other page tests here (the Vitest
 * environment is node, with no DOM). The server-side authorization these
 * mirror is covered by backend/tests/Feature/ScheduledReportTest.php.
 */
describe('Scheduled Reports module', () => {
  it('is a navigation entry and a page title of its own', () => {
    const item = NAV_ITEMS.find((i) => i.id === 'scheduled-reports');
    expect(item).toMatchObject({
      label: 'Scheduled Reports',
      section: 'administration',
    });
    expect(PAGE_TITLES['scheduled-reports']).toBe('Scheduled Reports');
  });

  it('is granted to the BADAC Administrator and to no other role', () => {
    expect(ROLES.badac_admin.modules).toContain('scheduled-reports');
    expect(ROLES.encoder.modules).not.toContain('scheduled-reports');
    expect(ROLES.badac_readonly.modules).not.toContain('scheduled-reports');
  });

  it('has a guarded route', () => {
    const routes = read('..', 'routes', 'AppRoutes.jsx');
    expect(routes).toContain('path="/scheduled-reports"');
    expect(routes).toContain("guarded('scheduled-reports', ScheduledReports)");
  });

  it('is no longer rendered inside System Settings', () => {
    const settings = read('Settings.jsx');
    expect(settings).not.toContain('ScheduledReportsSection');
    expect(
      existsSync(join(here, '..', 'components', 'settings', 'ScheduledReportsSection.jsx')),
    ).toBe(false);
  });

  it('keeps every existing capability and adds loading, error and empty states', () => {
    const page = read('ScheduledReports.jsx');
    for (const call of [
      'reportScheduleService.list()',
      'reportScheduleService.logs()',
      'reportScheduleService.create(',
      'reportScheduleService.update(',
      'reportScheduleService.remove(',
      'reportScheduleService.run(',
    ]) {
      expect(page).toContain(call);
    }
    expect(page).toContain('Create Scheduled Report');
    expect(page).toMatch(/Loading\s+scheduled reports/);
    expect(page).toContain('Scheduled reports could not be loaded.');
    expect(page).toContain('No scheduled reports yet');
    // Destructive and outward-facing actions are confirmed first.
    expect(page).toContain('Delete scheduled report?');
    expect(page).toContain('Send this report now?');
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
