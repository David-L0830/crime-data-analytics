import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The ordering shown on screen must be the ordering written to the file.
 *
 * This is the same class of guarantee exportSurfaces.test.js already makes for
 * COLUMNS, applied to ROW ORDER, and it guards the specific failure the
 * reporting checklist cares about: a report that claims on screen to be sorted
 * by date while the generated .xlsx/.csv carries the unsorted rows. The way
 * that is prevented is structural — each report surface sorts once, into one
 * `sorted` array, and the table, the printed document and both export handlers
 * all read that array. There is no second ordering to fall out of step.
 *
 * Asserted against the source text, the same way exportSurfaces.test.js guards
 * the column projection: these pages need a DOM and a DataContext to render,
 * and this suite runs in Vitest's `node` environment. The ordering logic itself
 * is covered directly in src/utils/sortRecords.test.js.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(join(here, file), 'utf8');

// The four report surfaces that render a record LIST, which is what a column
// sort applies to. Deliberately not here: the Crime Reporting Dashboard's four
// aggregate tables and the Statistical Analysis crosstab. Those summarise the
// records rather than listing them, so their on-screen row order has no
// counterpart in the record-level projection their exports write — sorting
// them would create exactly the screen/file mismatch this suite exists to
// prevent, not remove it.
const SORTED_SURFACES = [
  'IncidentFeed.jsx',
  'AuditLogs.jsx',
  'CriminalRecords.jsx',
  'VictimRecords.jsx',
];

describe.each(SORTED_SURFACES)('%s', (file) => {
  const source = read(file);

  it('derives its ordering from the shared useTableSort hook', () => {
    // One implementation, not four. Four private copies would be four chances
    // for one page to sort its table without sorting what it exports.
    expect(source).toContain("from '../hooks/useTableSort'");
    expect(source).toMatch(
      /const \{ sort, sorted, toggleSort, sortSummary \} = useTableSort\(filtered\)/,
    );
  });

  it('renders the sorted rows in its table, not the unsorted ones', () => {
    expect(source).toContain('rows={sorted}');
    expect(source).not.toContain('rows={filtered}');
  });

  it('gives the table the sort state and the toggle handler', () => {
    expect(source).toContain('sort={sort}');
    expect(source).toContain('onSort={toggleSort}');
  });

  it('exports the sorted rows through the shared export projection', () => {
    // `rows: sorted` inside exportSpec() is the single line that makes the
    // .xlsx and the .csv carry the order the user is looking at. Both export
    // handlers spread exportSpec(), so neither can opt out of it.
    expect(source).toMatch(/rows: sorted,/);
    expect(source).not.toMatch(/rows: filtered,/);
  });

  it('records the active ordering in the generated file metadata', () => {
    // A report sample is evidence, and evidence that does not describe its own
    // scope proves less. The filter summary already travels with the file;
    // the sort summary travels the same way.
    expect(source).toContain('sortSummary');
  });
});

describe('Crime Data Collection printed document', () => {
  it('states the ordering in the printed report header', () => {
    // IncidentFeed is the one sortable surface that also renders a
    // PrintReport, so the printed A4 document carries the sort line next to
    // the filter line. A printed record that does not say how it was ordered
    // cannot be checked against the screen it came from.
    const source = read('IncidentFeed.jsx');
    const header = source.slice(
      source.indexOf('<PrintReport'),
      source.indexOf('</PrintReport>'),
    );
    expect(header).toContain('sortSummary');
  });
});

describe('aggregate report surfaces', () => {
  it.each(['Dashboard.jsx', 'Analytics.jsx'])(
    '%s does not sort a summary table into a record-level export',
    (file) => {
      const source = read(file);
      expect(source).not.toContain('onSort={toggleSort}');
    },
  );
});
