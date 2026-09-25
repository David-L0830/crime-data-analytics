import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countDistinctValues } from './Analytics.jsx';
import { countDistinctNames } from './Dashboard.jsx';

/**
 * Named Suspects / Named Victims — Crime Reporting Dashboard and Statistical
 * Analysis.
 *
 * The incident form stores the suspect and victim as names on the incident;
 * it never writes to the Criminal / Victim record tables. So these KPIs count
 * DISTINCT NAMES on the incidents in view: an exact name is one person (the
 * identity the Dashboard's Repeat Offenders table already groups by), and an
 * incident that names nobody adds nobody.
 *
 * Which incidents are "in view" — validated and not archived, then the
 * FilterBar — is pinned for both pages by officialDataScope.test.js. This file
 * pins the counting itself, that the two pages count identically, and that
 * each KPI counts from that official `filtered` set.
 */

const incident = (over) => ({ suspectName: null, victimName: null, ...over });

// Same predicate both pages apply to their base set.
const official = (r) =>
  r.status !== 'Archived' && r.validationStatus === 'validated';

const counters = {
  'Statistical Analysis (countDistinctValues)': countDistinctValues,
  'Dashboard (countDistinctNames)': countDistinctNames,
};

describe.each(Object.entries(counters))('%s', (_, count) => {
  it('counts a name that appears on several incidents once', () => {
    const records = [
      incident({ suspectName: 'Juan Dela Cruz' }),
      incident({ suspectName: 'Juan Dela Cruz' }),
      incident({ suspectName: 'Pedro Santos' }),
    ];
    expect(count(records, 'suspectName')).toBe(2);
  });

  it('does not count an incident that names nobody', () => {
    const records = [
      incident({ victimName: 'Maria Reyes' }),
      incident({ victimName: null }),
      incident({ victimName: undefined }),
      incident({ victimName: '' }),
    ];
    expect(count(records, 'victimName')).toBe(1);
  });

  it('is zero when no incident names anyone', () => {
    expect(count([incident(), incident()], 'suspectName')).toBe(0);
  });

  it('counts suspects and victims independently', () => {
    const records = [
      incident({ suspectName: 'A', victimName: 'B' }),
      incident({ suspectName: 'A', victimName: 'C' }),
    ];
    expect(count(records, 'suspectName')).toBe(1);
    expect(count(records, 'victimName')).toBe(2);
  });

  it('counts only the official incidents it is given', () => {
    const records = [
      incident({ suspectName: 'Official One', status: 'Open', validationStatus: 'validated' }),
      incident({ suspectName: 'Official One', status: 'Solved', validationStatus: 'validated' }),
      incident({ suspectName: 'Official Two', status: 'Open', validationStatus: 'validated' }),
      incident({ suspectName: 'Pending', status: 'Open', validationStatus: 'pending' }),
      incident({ suspectName: 'Returned', status: 'Open', validationStatus: 'returned' }),
      incident({ suspectName: 'Archived', status: 'Archived', validationStatus: 'validated' }),
    ];
    expect(count(records.filter(official), 'suspectName')).toBe(2);
  });
});

describe('both pages count from their official filtered set', () => {
  const read = (file) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), 'utf8');

  it('Statistical Analysis', () => {
    const src = read('Analytics.jsx');
    expect(src).toContain("countDistinctValues(filtered, 'suspectName')");
    expect(src).toContain("countDistinctValues(filtered, 'victimName')");
  });

  it('Crime Reporting Dashboard', () => {
    const src = read('Dashboard.jsx');
    expect(src).toContain("countDistinctNames(filtered, 'suspectName')");
    expect(src).toContain("countDistinctNames(filtered, 'victimName')");
  });
});
