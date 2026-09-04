import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard: the Dashboard must never again display "Today Imported" /
 * "Month Imported" as though they were real statistics.
 *
 * THE DEFECT THIS GUARDS AGAINST
 * -------------------------------
 * Those two KPI cards summed `records_received` over the `sync_logs` table,
 * but nothing in this application ever wrote a real row there — the only
 * writer was SyncLogSeeder, which inserts ten rows of random_int() counts
 * under fake source names ("PNP Regional Feed", "Manual Upload", "BADAC Field
 * Report") for demo purposes. The Dashboard was showing a confident number
 * computed entirely from that fabricated data.
 *
 * The two cards and the three helper functions that fed them
 * (getTodayImportedCount, getThisMonthImportedCount, sumImported) have been
 * removed. This test pins that removal at both ends: the label can't come
 * back on the Dashboard, and the calculation can't quietly come back in
 * DataContext even if nothing currently renders it.
 *
 * WHAT THIS TEST DOES AND DOES NOT PROVE
 * ---------------------------------------
 * SOURCE-LEVEL guard, matching this suite's established approach (see
 * context/authMfaGate.test.js and components/incidents/incidentModalFocus.test.js
 * for the same rationale) — Vitest runs here in a Node environment with no DOM
 * (see vitest.config.js), so a rendered Dashboard cannot be inspected without
 * adding jsdom, which is outside this fix's scope.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE
 * ----------------------------------------
 * This file does not touch any other KPI, chart, or Dashboard layout detail —
 * only the specific fabricated-data defect. It also does not assert that the
 * sync_logs infrastructure (SyncLogController, SyncLogSeeder, syncLogService,
 * the syncLogs fetch, or getLastSync) is absent — removing those was
 * explicitly out of scope for this fix, and they remain in place.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(join(here, relative), 'utf8');

const dashboard = read('Dashboard.jsx');
const dataContext = read('../context/DataContext.jsx');

describe('Dashboard no longer shows the fabricated import KPIs', () => {
  it('does not render a "Today Imported" or "Month Imported" card', () => {
    expect(dashboard).not.toContain('Today Imported');
    expect(dashboard).not.toContain('Month Imported');
  });

  it('does not call the removed sync-derived count helpers', () => {
    expect(dashboard).not.toContain('getTodayImportedCount');
    expect(dashboard).not.toContain('getThisMonthImportedCount');
  });
});

describe('DataContext no longer computes the fabricated import counts', () => {
  it('does not define the removed helpers', () => {
    expect(dataContext).not.toMatch(/\bsumImported\b/);
    expect(dataContext).not.toMatch(/\bgetTodayImportedCount\b/);
    expect(dataContext).not.toMatch(/\bgetThisMonthImportedCount\b/);
  });

  // Boundary check, not scope creep: this fix explicitly leaves the raw
  // sync_logs fetch and getLastSync in place (they were not part of the
  // fabricated-KPI defect). If a future change removes the calculation
  // helpers again, it should not also silently take these with it.
  it('still fetches sync logs and still exposes getLastSync, unchanged by this fix', () => {
    expect(dataContext).toContain('syncLogService.list()');
    expect(dataContext).toContain('const getLastSync = useCallback(');
  });
});
