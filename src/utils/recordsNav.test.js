import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  activeRecordsItem,
  isRecordsPath,
  RECORDS_SUBITEMS,
  CRIMINAL_RECORDS_PATH,
  VICTIM_RECORDS_PATH,
} from './recordsNav';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, ...p), 'utf8');

describe('Records sidebar active state', () => {
  it('maps each list route to its own entry', () => {
    expect(activeRecordsItem('/criminal-records/criminal')).toBe('criminal');
    expect(activeRecordsItem('/criminal-records/victim')).toBe('victim');
    expect(activeRecordsItem('/criminal-records/victim/')).toBe('victim');
  });

  it('keeps the right entry highlighted on profile pages', () => {
    expect(activeRecordsItem('/criminal-records/42')).toBe('criminal');
    expect(activeRecordsItem('/criminal-records/victims/7')).toBe('victim');
  });

  it('is inactive outside the group and on the bare redirect path', () => {
    expect(activeRecordsItem('/criminal-records')).toBeNull();
    expect(activeRecordsItem('/incident-feed')).toBeNull();
    expect(activeRecordsItem('/criminal-recordsX/criminal')).toBeNull();
    expect(isRecordsPath('/criminal-records')).toBe(true);
    expect(isRecordsPath('/criminal-records/12')).toBe(true);
    expect(isRecordsPath('/dashboard')).toBe(false);
  });

  it('offers exactly Criminal Records and Victim Records', () => {
    expect(RECORDS_SUBITEMS.map((s) => [s.label, s.to])).toEqual([
      ['Criminal Records', CRIMINAL_RECORDS_PATH],
      ['Victim Records', VICTIM_RECORDS_PATH],
    ]);
  });
});

// Source-level guards (the Vitest environment is `node`, no DOM — same
// approach as sidebarDrawerA11y.test.js). Behavioural proof is a browser pass.
describe('Records is a navigation group, not a landing page', () => {
  const routes = read('..', 'routes', 'AppRoutes.jsx');
  const sidebar = read('..', 'components', 'layout', 'Sidebar.jsx');

  it('no longer routes to a Records chooser page', () => {
    expect(routes).not.toContain("import('../pages/Records')");
    expect(routes).toContain('<Navigate to="/criminal-records/criminal" replace />');
  });

  it('keeps both list routes and both profile routes', () => {
    expect(routes).toContain('path="/criminal-records/criminal"');
    expect(routes).toContain('path="/criminal-records/victim"');
    expect(routes).toContain('path="/criminal-records/victims/:id"');
    expect(routes).toContain('path="/criminal-records/:id"');
  });

  it('renders the group header as a disclosure button with aria state', () => {
    expect(sidebar).toContain('aria-expanded={recordsExpanded}');
    expect(sidebar).toContain('aria-controls={recordsSubmenuId}');
    // The old markup nested a <button> inside the NavLink <a>, which is
    // invalid interactive nesting. The header is now a single button.
    expect(sidebar).not.toContain('nav-expand-btn');
  });
});
