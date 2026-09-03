import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The .csv and the .xlsx on a report page must always describe the same data.
 *
 * The way that is guaranteed is structural rather than incidental: each page
 * declares ONE exportSpec() — the column projection, the labels, the order and
 * the filtered rows — and both export handlers spread it. There is no second
 * list of columns to fall out of step, so the two files cannot diverge.
 *
 * This suite asserts that structure, because it is the property that would
 * quietly break. Someone adding a column to a report will add it to the object
 * they can see; if a page ever grew a separate projection for its CSV, the
 * exports would agree on the day it was written and disagree a month later,
 * and nothing in a unit test of exportCsv itself would notice.
 *
 * Asserted against the source text, the same way incidentModalFocus.test.js
 * guards the modal contract: these pages need a DOM and a DataContext to
 * render, and this suite runs in Vitest's `node` environment. The serialisation
 * these pages hand off to is covered directly in src/utils/exportCsv.test.js.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(join(here, file), 'utf8');

// The six tabular report surfaces. The three single-record Field / Value
// exports — Criminal Profile, Victim Profile and the incident view modal — are
// deliberately not here: those produce a two-column record sheet of one
// subject, which is a document rather than a dataset, and a spreadsheet reader
// gains nothing from a comma-separated copy of it. They keep their .xlsx and
// their printed page.
const SURFACES = [
  {
    file: 'Dashboard.jsx',
    stem: 'brgy178_dashboard_${today()}',
    report: 'dashboard',
  },
  {
    file: 'Analytics.jsx',
    stem: 'brgy178_analytics_${today()}',
    report: 'analytics',
  },
  {
    file: 'IncidentFeed.jsx',
    stem: 'incidents_${today()}',
    report: 'incidents',
  },
  {
    file: 'AuditLogs.jsx',
    stem: 'audit_logs_${today()}',
    report: 'audit-logs',
  },
  {
    file: 'CriminalRecords.jsx',
    stem: 'criminal_records_${today()}',
    report: 'criminal-records',
  },
  {
    file: 'VictimRecords.jsx',
    stem: 'victim_records_${today()}',
    report: 'victim-records',
  },
];

describe.each(SURFACES)('$file exports .xlsx and .csv from one projection', ({
  file,
  stem,
  report,
}) => {
  const source = read(file);

  it('declares exactly one exportSpec()', () => {
    const declarations = source.match(/const exportSpec = \(\) => \(\{/g) || [];
    expect(declarations).toHaveLength(1);
  });

  it('declares exactly one column projection on the page', () => {
    // The assertion that actually prevents drift: a second `columns:` array
    // means a second projection to maintain.
    const projections = source.match(/^\s{4}columns: \[$/gm) || [];
    expect(projections).toHaveLength(1);
  });

  it('builds the workbook from that spec', () => {
    expect(source).toContain(`filename: \`${stem}.xlsx\`,`);
    expect(source).toMatch(
      /await exportWorkbook\(\{\s*\n\s*filename: `[^`]+\.xlsx`,\s*\n\s*\.\.\.exportSpec\(\),\s*\n\s*\}\)/,
    );
  });

  it('builds the CSV from the same spec', () => {
    expect(source).toContain(`filename: \`${stem}.csv\`,`);
    expect(source).toMatch(
      /exportCsv\(\{\s*\n\s*filename: `[^`]+\.csv`,\s*\n\s*\.\.\.exportSpec\(\),\s*\n\s*\}\)/,
    );
  });

  it('names the two files identically apart from the extension', () => {
    // A report an evaluator downloads twice should not arrive under two
    // unrelated names.
    expect(source).toContain(`\`${stem}.xlsx\``);
    expect(source).toContain(`\`${stem}.csv\``);
  });

  it('imports the shared CSV helper and no local serialiser', () => {
    expect(source).toContain(
      "import { exportCsv } from '../utils/exportCsv';",
    );
    // No page may build comma-separated text itself. These are the shapes the
    // removed per-module CSV exporters had.
    expect(source).not.toContain('text/csv');
    expect(source).not.toMatch(/\.join\(','\)/);
    expect(source).not.toMatch(/Object\.keys\([^)]*\)\.join/);
  });

  it('audits the CSV export under the same report key as the workbook', () => {
    // AuditLogController::REPORTS is the server-side whitelist; a key outside
    // it is rejected with a 422 and the export goes unrecorded.
    const logged = source.match(/auditLogService\.logExport\('([^']+)'\)/g) || [];
    expect(logged).toEqual([
      `auditLogService.logExport('${report}')`,
      `auditLogService.logExport('${report}')`,
    ]);
  });

  it('records the CSV export only after a successful download', () => {
    // exportCsv returns false for both "nothing to export" and "the export
    // failed", and the audit call sits inside the success branch, so neither
    // is ever written up as a REPORT_EXPORTED.
    const csvHandler = source.slice(
      source.indexOf('const ok = exportCsv({'),
      source.indexOf('const ok = exportCsv({') + 600,
    );
    expect(csvHandler).toMatch(/if \(ok\) \{/);
    expect(csvHandler.indexOf('if (ok) {')).toBeLessThan(
      csvHandler.indexOf('logExport'),
    );
  });

  it('offers the CSV export as its own button', () => {
    expect(source).toMatch(
      /onClick=\{handleExport(Csv|LogsCsv)\}[\s\S]{0,120}Export CSV/,
    );
  });
});

describe('the shared exporters stay one implementation each', () => {
  it('no page imports exceljs directly', () => {
    for (const { file } of SURFACES) {
      expect(read(file)).not.toContain("from 'exceljs'");
    }
  });

  it('exportCsv never enumerates a record’s own keys', () => {
    // The defect that got the previous CSV export removed. Asserted on the
    // module itself so it cannot come back through a helper either.
    const util = readFileSync(join(here, '..', 'utils', 'exportCsv.js'), 'utf8');
    expect(util).not.toMatch(/Object\.keys\(row/);
    expect(util).not.toMatch(/Object\.entries\(row/);
    expect(util).not.toMatch(/for \(const \w+ in row/);
    // Values are read only through a declared accessor or a declared key.
    expect(util).toContain(
      "typeof c.value === 'function' ? c.value(row) : row[c.key]",
    );
  });
});
