import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { filterRecords } from '../utils/helpers';

/**
 * CP-5A — the analytic pages show OFFICIAL data.
 *
 * Only a validated, non-archived incident is official downstream data
 * (Phase 2B). Before this checkpoint the Crime Reporting Dashboard,
 * Statistical Analysis and Trend and Pattern Detection counted every active
 * record regardless of validation state, so an encoding nobody had reviewed
 * moved the same KPIs, charts, alerts, exports and printed reports as a
 * reviewed one, and was indistinguishable from it on the page.
 *
 * WHY THE RULE IS NOT IN filterRecords()
 * --------------------------------------
 * That helper is shared with Crime Mapping, whose data arrives from a separate
 * endpoint with its own server-side rule, and it also backs the Metabase-driven
 * filter contract. Putting a validation rule inside it would change surfaces
 * this checkpoint is not about. Each page applies it to its own base set
 * instead, which is also where the archive rule already lives.
 *
 * DOM caveat, as everywhere in this suite: Vitest runs in a Node environment
 * (vitest.config.js), so the pages cannot be rendered. The predicate is
 * exercised as a real pure function — composed with the REAL filterRecords, so
 * the interaction between the two is tested rather than assumed — and the
 * wiring is pinned structurally, because structure is how it regresses.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(join(here, file), 'utf8');

// The pages' own comments name `validationStatus` and 'Archived' while
// explaining them, so structural checks must read executable text only. Same
// approach as pages/exportMetadata.test.js and pages/incidentFeedVisibility.test.js.
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PAGES = [
  { file: 'Dashboard.jsx', prefix: 'dash', label: 'Crime Reporting Dashboard' },
  { file: 'Analytics.jsx', prefix: 'ana', label: 'Statistical Analysis' },
  { file: 'Trends.jsx', prefix: 'tr', label: 'Trend and Pattern Detection' },
];

// ---------------------------------------------------------------------------
// The rule itself, mirrored from the three pages' base sets.
// ---------------------------------------------------------------------------
const official = (records) =>
  records.filter(
    (r) => r.status !== 'Archived' && r.validationStatus === 'validated',
  );

const ids = (rows) => rows.map((r) => r.id);

const records = [
  // validated + active → the only official records
  {
    id: 1,
    status: 'Open',
    validationStatus: 'validated',
    date: '2026-05-10',
    crimeType: 'Theft',
    sitio: 'Sitio 1',
  },
  {
    id: 2,
    status: 'Solved',
    validationStatus: 'validated',
    date: '2026-05-12',
    crimeType: 'Robbery',
    sitio: 'Sitio 2',
  },
  // pending + active → excluded
  {
    id: 3,
    status: 'Open',
    validationStatus: 'pending',
    date: '2026-05-11',
    crimeType: 'Vandalism',
    sitio: 'Sitio 3',
  },
  // returned + active → excluded
  {
    id: 4,
    status: 'Under Investigation',
    validationStatus: 'returned',
    date: '2026-05-13',
    crimeType: 'Theft',
    sitio: 'Sitio 3',
  },
  // validated + archived → excluded by the archive rule
  {
    id: 5,
    status: 'Archived',
    validationStatus: 'validated',
    date: '2026-05-01',
    crimeType: 'Theft',
    sitio: 'Sitio 1',
  },
  // pending + archived → excluded twice over
  {
    id: 6,
    status: 'Archived',
    validationStatus: 'pending',
    date: '2026-05-02',
    crimeType: 'Assault',
    sitio: 'Sitio 3',
  },
];

describe('the official-data predicate', () => {
  it('includes a validated, non-archived record', () => {
    expect(ids(official(records))).toContain(1);
    expect(ids(official(records))).toContain(2);
  });

  it('excludes a pending, non-archived record', () => {
    expect(ids(official(records))).not.toContain(3);
  });

  it('excludes a returned, non-archived record', () => {
    expect(ids(official(records))).not.toContain(4);
  });

  it('excludes a validated but archived record', () => {
    // The archive rule is independent and still applies: being reviewed does
    // not put a retired record back into the barangay's current picture.
    expect(ids(official(records))).not.toContain(5);
  });

  it('excludes a pending, archived record', () => {
    expect(ids(official(records))).not.toContain(6);
  });

  it('admits exactly the official set and nothing else', () => {
    expect(ids(official(records))).toEqual([1, 2]);
  });

  it('is empty rather than permissive when nothing has been validated', () => {
    // Fails CLOSED. A page with no validated data must show nothing, not
    // everything — the safe direction for a figure people act on.
    const noneReviewed = records.map((r) => ({
      ...r,
      validationStatus: 'pending',
    }));
    expect(official(noneReviewed)).toHaveLength(0);
  });

  it('treats a missing validationStatus as not official', () => {
    // A record that predates the field, or one a projection forgot to carry,
    // must not be counted as reviewed by default.
    expect(official([{ id: 9, status: 'Open' }])).toHaveLength(0);
  });
});

describe('the rule composes with the existing filters', () => {
  it('narrows what the FilterBar then filters, and never widens it', () => {
    const scoped = filterRecords(official(records), { crimeType: 'Theft' });
    // Record 5 is Theft too, but archived; 4 is Theft but returned.
    expect(ids(scoped)).toEqual([1]);
  });

  it('cannot be reached around by selecting a status', () => {
    // Sitio 3 holds only unvalidated records in this fixture, so a Sitio 3
    // selection on an official page must come back empty.
    expect(filterRecords(official(records), { sitio: 'Sitio 3' })).toHaveLength(
      0,
    );
  });

  it('leaves filterRecords itself untouched', () => {
    // The shared helper is also Crime Mapping's client-side pass and backs the
    // Metabase filter contract. A validation rule placed there would change
    // surfaces this checkpoint is not about.
    const helpers = read('../utils/helpers.js');
    expect(helpers).not.toMatch(/validationStatus/);
    // Proven behaviourally as well as structurally: given the raw set, the
    // helper still returns unvalidated records.
    expect(ids(filterRecords(records, { sitio: 'Sitio 3' }))).toEqual([3, 4, 6]);
  });
});

describe.each(PAGES)('$label applies the rule to its base set', ({ file }) => {
  const code = stripComments(read(file));
  const base = code.slice(
    code.indexOf('const filtered = useMemo('),
    code.indexOf('[records, filters]'),
  );

  it('filters the records it hands to filterRecords', () => {
    expect(base).toMatch(
      /records\.filter\(\s*\(r\) =>\s*r\.status !== 'Archived' && r\.validationStatus === 'validated',?\s*\)/,
    );
  });

  it('keeps the archive rule rather than replacing it', () => {
    expect(base).toMatch(/r\.status !== 'Archived'/);
  });

  it('still routes everything through the shared filterRecords helper', () => {
    expect(base).toMatch(/filterRecords\(/);
  });

  it('applies the rule once, at the base, not per chart', () => {
    // One base set is what makes the KPIs, the charts, the exports and the
    // printed document agree with each other by construction.
    expect(code.match(/validationStatus === 'validated'/g)).toHaveLength(1);
  });

  it('states the scope on the printed and exported document', () => {
    // "All" was never written on these pages — the ABSENCE of a Validation
    // line is what implied it.
    expect(code).toMatch(/'Validation: Validated only',/);
    expect(code).toMatch(/filterSummary/);
  });
});

describe('everything on those pages derives from the filtered set', () => {
  it('Dashboard counts and exports the same array', () => {
    const code = stripComments(read('Dashboard.jsx'));
    expect(code).toMatch(/const total = filtered\.length;/);
    expect(code).toMatch(/^\s{4}rows: filtered,$/m);
    expect(code).toMatch(/rowCount: filtered\.length,/);
    expect(code).not.toMatch(/rows: records,/);
  });

  it('Analytics counts and exports the same array', () => {
    const code = stripComments(read('Analytics.jsx'));
    expect(code).toMatch(/^\s{4}rows: filtered,$/m);
    expect(code).toMatch(/rowCount: filtered\.length,/);
    expect(code).not.toMatch(/rows: records,/);
  });

  it('Trends derives its alerts and hotspots from the same array', () => {
    const code = stripComments(read('Trends.jsx'));
    expect(code).toMatch(/countBy\(filtered,/);
    expect(code).toMatch(/const totalForAlerts = filtered\.length;/);
    expect(code).not.toMatch(/countBy\(records,/);
  });
});

describe('CP-4 and the Validation queue are untouched', () => {
  const feed = stripComments(read('IncidentFeed.jsx'));

  it('Crime Data Collection keeps its own CP-4 rule', () => {
    // The Feed is the one page where a reviewer must still be able to reach
    // unvalidated records — it owns the queue. CP-5A must not reach into it.
    expect(feed).toMatch(/const permitted = \(r\) =>/);
    expect(feed).toMatch(/const defaultVisible = \(r\) =>/);
    expect(feed).toMatch(/archiveRuled\.filter\(defaultVisible\)/);
  });

  it('the validation queue still sees pending and returned records', () => {
    const queueMemo = feed.slice(
      feed.indexOf('const validationQueue = useMemo('),
      feed.indexOf('const handleOpenValidation'),
    );
    expect(queueMemo).toMatch(/r\.validationStatus === 'pending'/);
    expect(queueMemo).toMatch(/r\.validationStatus === 'returned'/);
    expect(queueMemo).toMatch(/\[records\]/);
  });
});
