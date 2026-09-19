import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATUSES } from '../utils/constants';

/**
 * A scheduled report is always official-data scoped: ReportGenerator applies
 * Incident::scopeOfficial() (validated, non-archived only), unconditionally,
 * before any caller-supplied filter is applied. So a schedule's Case-status
 * filter set to "Archived" is a self-contradiction — it can never match a
 * row — yet the form used to offer it as a plain, unexplained option,
 * letting a schedule be saved that silently produces an empty report on
 * every run, forever.
 *
 * SOURCE-LEVEL guard, matching this suite's established approach for
 * ScheduledReports.jsx-adjacent regression pins (see dashboardFakeKpis.test.js) —
 * Vitest runs here in a Node environment with no DOM (vitest.config.js), so a
 * rendered form cannot be inspected without adding jsdom, which is outside
 * this fix's scope.
 */

const here = dirname(fileURLToPath(import.meta.url));
const scheduledReports = readFileSync(join(here, 'ScheduledReports.jsx'), 'utf8');

describe('Scheduled Reports Case-status filter no longer offers Archived', () => {
  it('defines a schedule-status list derived from STATUSES with Archived removed', () => {
    expect(scheduledReports).toMatch(
      /const SCHEDULE_STATUSES = STATUSES\.filter\(\s*\(s\) => s !== 'Archived',?\s*\)/,
    );
  });

  it('renders the Case-status select from SCHEDULE_STATUSES, not the raw STATUSES list', () => {
    expect(scheduledReports).toContain('{SCHEDULE_STATUSES.map((s) => (');
  });

  // Cross-checks the filtered list against the real, current STATUSES
  // vocabulary rather than a hard-coded copy, so this test does not drift if
  // that vocabulary ever changes.
  it('SCHEDULE_STATUSES keeps every status except Archived', () => {
    const scheduleStatuses = STATUSES.filter((s) => s !== 'Archived');

    expect(scheduleStatuses).not.toContain('Archived');
    expect(scheduleStatuses).toEqual(['Open', 'Under Investigation', 'Solved', 'Closed']);
  });
});
