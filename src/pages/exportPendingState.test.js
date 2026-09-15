import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every Excel export must show that it is running and refuse a second start.
 *
 * exportWorkbook() dynamically imports exceljs — a ~930 kB chunk fetched on
 * first use — and then builds the sheet. It is the slowest thing a user can
 * ask this application to do, and until Section 7 Phase 2 it gave no feedback
 * at all between the click and the download: no spinner, no disabled state, no
 * label change. On a slow connection that reads as a dead button, and clicking
 * a dead button again started a second export.
 *
 * WHAT THIS SUITE IS, AND WHAT IT IS NOT
 *
 * These are SOURCE-LEVEL regression guards, asserted against the file text the
 * same way exportSurfaces.test.js and incidentModalFocus.test.js are. The
 * Vitest environment is `node` with no DOM (see vitest.config.js), so nothing
 * here renders a component, clicks a button, or observes a disabled attribute.
 *
 * They prove the wiring is present in the source. They do NOT prove the
 * spinner appears, that the button is really unclickable mid-export, or that
 * the export works — that is browser evidence, and it has to be gathered in a
 * browser. What this catches is the realistic regression: one of nine export
 * surfaces being added or rewritten later without the pending state, which is
 * exactly how the original defect was distributed across nine files.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(join(here, file), 'utf8');

// Every surface that builds a workbook, with the handler each one wraps.
// CriminalProfile, VictimProfile and the incident view modal are single-record
// Field/Value exports rather than tabular reports — they are not in
// exportSurfaces.test.js for that reason — but they run the same slow helper
// behind the same kind of button, so they carry the same obligation.
const SURFACES = [
  ['Dashboard.jsx', 'handleExportExcel'],
  ['Analytics.jsx', 'handleExportExcel'],
  ['IncidentFeed.jsx', 'handleExportExcel'],
  ['CriminalRecords.jsx', 'handleExportExcel'],
  ['VictimRecords.jsx', 'handleExportExcel'],
  ['AuditLogs.jsx', 'handleExportLogs'],
  ['CriminalProfile.jsx', 'handleExportProfile'],
  ['VictimProfile.jsx', 'handleExportProfile'],
  ['../components/incidents/IncidentModal.jsx', 'handleExportRecord'],
];

describe.each(SURFACES)('%s reports its export in progress', (file, handler) => {
  const source = read(file);

  it('builds the handler through the shared pending-action hook', () => {
    // One implementation, not nine copies of a useState pair.
    expect(source).toContain('usePendingAction');
    expect(source).toContain(
      `const [exporting, ${handler}] = usePendingAction(async () => {`,
    );
  });

  it('disables the trigger and marks it busy while running', () => {
    expect(source).toContain('disabled={exporting}');
    expect(source).toContain('aria-busy={exporting}');
  });

  it('replaces the label with a spinner and progress wording', () => {
    expect(source).toContain('spinner spinner-inline');
    expect(source).toContain('Exporting…');
    // The spinner is decoration; the wording beside it carries the meaning.
    expect(source).toMatch(
      /<span className="spinner spinner-inline" aria-hidden="true" \/>/,
    );
  });

  it('still records the export exactly as it did before', () => {
    // The pending state must not have changed WHAT an export does. Both the
    // success toast and the audit call stay inside the `if (ok)` branch.
    expect(source).toContain('auditLogService.logExport(');
    expect(source).toMatch(/if \(ok\) \{/);
  });
});

describe('usePendingAction', () => {
  const hook = readFileSync(
    join(here, '..', 'hooks', 'usePendingAction.js'),
    'utf8',
  );

  it('resets in a finally block so a failure cannot strand the button', () => {
    // Without this, one thrown error leaves the export button disabled for the
    // rest of the session.
    expect(hook).toMatch(/} finally \{[\s\S]*?running\.current = false;/);
    expect(hook).toMatch(/} finally \{[\s\S]*?setPending\(false\);/);
  });

  it('guards re-entry with a ref, not with the state flag', () => {
    // A state update is not synchronous: two clicks in the same tick would
    // both read pending === false. The ref is written immediately, so the
    // second call returns having started nothing.
    expect(hook).toContain('if (running.current) return undefined;');
    expect(hook).toMatch(/running\.current = true;[\s\S]*?setPending\(true\);/);
  });

  it('does not swallow the error it wrapped', () => {
    // finally, not catch — whatever the action throws still propagates to the
    // caller exactly as it did before the wrapper existed.
    expect(hook).not.toMatch(/catch\s*\(/);
  });
});
