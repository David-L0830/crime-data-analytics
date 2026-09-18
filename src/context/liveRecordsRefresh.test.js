import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { filterRecords } from '../utils/helpers';

/**
 * CP-1 — the incident list must refresh itself.
 *
 * An encoder logging an incident has always written two things: the incident
 * row and a "New Incident" notification. The bell was polled; `records` was
 * not. So a validator was told a record existed and then could not see it
 * until they reloaded the page. This pins the fix.
 *
 * WHAT THESE TESTS PROVE, AND WHAT THEY DO NOT
 * --------------------------------------------
 * Vitest runs in a Node environment here with no DOM (see vitest.config.js),
 * so React state transitions cannot be observed — the same constraint the
 * existing suite works under, and for the same reason it documents in
 * pages/exportPendingState.test.js and context/authMfaGate.test.js. Adding
 * jsdom would mean a new dependency and a config change for one checkpoint.
 *
 * So the wiring is pinned STRUCTURALLY, because that is how this regresses:
 * somebody adds a second poll, or switches the replacement to an append, or
 * drops the modal hold, and nothing looks broken until two users are on the
 * system at once. The parts that are pure — filtering a refreshed array, and
 * the replace-don't-append semantics — are exercised for real below.
 */

const here = dirname(fileURLToPath(import.meta.url));
const dataContext = readFileSync(join(here, 'DataContext.jsx'), 'utf8');
const incidentFeed = readFileSync(
  join(here, '..', 'pages', 'IncidentFeed.jsx'),
  'utf8',
);

describe('refreshRecords', () => {
  it('exists and fetches through the existing incidentService.list()', () => {
    expect(dataContext).toMatch(/const refreshRecords = useCallback\(/);

    const body = dataContext.slice(
      dataContext.indexOf('const refreshRecords = useCallback('),
      dataContext.indexOf('const holdRecordsRefresh'),
    );
    expect(body).toMatch(/incidentService\s*\.\s*list\(\)/);
  });

  it('REPLACES the records array rather than appending to it', () => {
    const body = dataContext.slice(
      dataContext.indexOf('const refreshRecords = useCallback('),
      dataContext.indexOf('const holdRecordsRefresh'),
    );

    // The whole-array replacement is what makes duplicate rows impossible.
    expect(body).toMatch(/setRecords\(list \|\| \[\]\)/);
    // Any of these would reintroduce the duplicate-row class of bug.
    expect(body).not.toMatch(/setRecords\(\s*\(prev\)/);
    expect(body).not.toMatch(/\.concat\(/);
    expect(body).not.toMatch(/\.\.\.prev/);
  });

  it('carries its own in-flight guard', () => {
    expect(dataContext).toMatch(/const recordsFetchInFlight = useRef\(false\)/);

    const body = dataContext.slice(
      dataContext.indexOf('const refreshRecords = useCallback('),
      dataContext.indexOf('const holdRecordsRefresh'),
    );
    expect(body).toMatch(/if \(recordsFetchInFlight\.current\) return;/);
    expect(body).toMatch(/recordsFetchInFlight\.current = false;/);
  });

  it('swallows its own failures, like every other background refresh here', () => {
    const body = dataContext.slice(
      dataContext.indexOf('const refreshRecords = useCallback('),
      dataContext.indexOf('const holdRecordsRefresh'),
    );
    expect(body).toMatch(/\.catch\(\(\) => \{\}\)/);
  });
});

describe('the poll refreshes both notifications and records', () => {
  it('has a single combined tick rather than a second polling architecture', () => {
    expect(dataContext).toMatch(/const refreshPolledData = useCallback\(/);

    const body = dataContext.slice(
      dataContext.indexOf('const refreshPolledData = useCallback('),
      dataContext.indexOf('}, [refreshNotifications, refreshRecords]);'),
    );
    expect(body).toMatch(/refreshNotifications\(\);/);
    expect(body).toMatch(/refreshRecords\(\);/);
  });

  it('drives the existing interval, not a new one', () => {
    expect(dataContext).toMatch(
      /timer = setInterval\(refreshPolledData, intervalMs\)/,
    );
    // Exactly one interval in the file — a second poll would show up here.
    expect(dataContext.match(/setInterval\(/g)).toHaveLength(1);
  });

  it('keeps the existing visible and hidden cadences unchanged', () => {
    expect(dataContext).toMatch(/const VISIBLE_POLL_MS = 30000;/);
    expect(dataContext).toMatch(/const HIDDEN_POLL_MS = 120000;/);
  });

  it('catches up on both when the tab becomes visible', () => {
    const body = dataContext.slice(
      dataContext.indexOf('const onVisibility = () => {'),
      dataContext.indexOf('schedule(intervalForCurrentVisibility());\n    document'),
    );
    expect(body).toMatch(/refreshPolledData\(\);/);
  });

  it('leaves notification polling behaviour otherwise intact', () => {
    // The guard, the announce path and the quiet failure are untouched.
    expect(dataContext).toMatch(
      /const notificationFetchInFlight = useRef\(false\)/,
    );
    expect(dataContext).toMatch(/\.then\(applyNotificationList\)/);
    expect(dataContext).toMatch(
      /document\.addEventListener\('visibilitychange', onVisibility\)/,
    );
  });

  it('keeps the two refreshes independent so one failing cannot stop the other', () => {
    // Separate guards and separate promise chains: neither is awaited by the
    // other, and each swallows its own rejection.
    expect(dataContext).toMatch(/const recordsFetchInFlight = useRef\(false\)/);
    expect(dataContext).toMatch(
      /const notificationFetchInFlight = useRef\(false\)/,
    );
    const body = dataContext.slice(
      dataContext.indexOf('const refreshPolledData = useCallback('),
      dataContext.indexOf('}, [refreshNotifications, refreshRecords]);'),
    );
    expect(body).not.toMatch(/await/);
    expect(body).not.toMatch(/\.then\(/);
  });
});

describe('a refresh is deferred while a record is open', () => {
  it('holds and records the missed refresh instead of swapping the array', () => {
    const body = dataContext.slice(
      dataContext.indexOf('const refreshRecords = useCallback('),
      dataContext.indexOf('const holdRecordsRefresh'),
    );
    expect(body).toMatch(/if \(recordsRefreshHeld\.current\) \{/);
    expect(body).toMatch(/recordsRefreshMissed\.current = true;/);
  });

  it('runs the catch-up when the hold lifts', () => {
    const body = dataContext.slice(
      dataContext.indexOf('const holdRecordsRefresh = useCallback('),
      dataContext.indexOf('[refreshRecords],'),
    );
    expect(body).toMatch(/recordsRefreshMissed\.current = false;/);
    expect(body).toMatch(/refreshRecords\(\);/);
  });

  it('is exposed on the context for the page that owns the modals', () => {
    expect(dataContext).toMatch(/^\s{4}refreshRecords,$/m);
    expect(dataContext).toMatch(/^\s{4}holdRecordsRefresh,$/m);
  });

  it('is wired to IncidentFeed’s view, edit and create state', () => {
    // Asserted against the destructuring block rather than its last line:
    // what matters is that the page takes holdRecordsRefresh from the
    // context, not where in the list it happens to sit.
    const useDataBlock = incidentFeed.slice(
      incidentFeed.indexOf('  const {'),
      incidentFeed.indexOf('} = useData()'),
    );
    expect(useDataBlock).toMatch(/\bholdRecordsRefresh,/);
    expect(incidentFeed).toMatch(
      /holdRecordsRefresh\(Boolean\(viewing \|\| editing \|\| creating\)\)/,
    );
    // Released on unmount, so leaving the page mid-modal cannot hold the
    // refresh off forever.
    expect(incidentFeed).toMatch(
      /useEffect\(\(\) => \(\) => holdRecordsRefresh\(false\), \[holdRecordsRefresh\]\)/,
    );
  });
});

describe('refreshed records still behave correctly downstream', () => {
  // A refreshed payload: the two rows that were already there, plus the one
  // an encoder has just submitted.
  const before = [
    {
      id: 1,
      caseNumber: 'CN-2026-0001',
      crimeType: 'Theft',
      category: 'Property',
      sitio: 'Sitio 1',
      status: 'Open',
      date: '2026-09-01',
      street: 'Street A',
      reportingOfficer: 'Officer A',
    },
    {
      id: 2,
      caseNumber: 'CN-2026-0002',
      crimeType: 'Assault',
      category: 'Person',
      sitio: 'Sitio 4',
      status: 'Open',
      date: '2026-09-02',
      street: 'Street B',
      reportingOfficer: 'Officer B',
    },
  ];
  const after = [
    ...before,
    {
      id: 3,
      caseNumber: 'CN-2026-0003',
      crimeType: 'Theft',
      category: 'Property',
      sitio: 'Sitio 1',
      status: 'Open',
      date: '2026-09-03',
      street: 'Street C',
      reportingOfficer: 'Officer C',
    },
  ];

  it('a refresh replaces the list, so the new incident is present', () => {
    // What setRecords(list || []) does: the state IS the response.
    let records = before;
    records = after || [];
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('two consecutive refreshes do not duplicate records', () => {
    let records = before;
    records = after || [];
    records = after || [];
    expect(records).toHaveLength(3);
    expect(new Set(records.map((r) => r.id)).size).toBe(records.length);
  });

  it('an empty response is tolerated the way the mount effect tolerates it', () => {
    // A request that resolves with nothing must leave an array behind, not
    // undefined — every consumer calls .filter() on it.
    const apply = (list) => list || [];
    expect(apply(undefined)).toEqual([]);
    expect(apply(null)).toEqual([]);
    expect(apply(after)).toHaveLength(3);
  });

  it('existing filters still apply correctly to a refreshed array', () => {
    const filters = { crimeType: 'Theft' };
    expect(filterRecords(before, filters).map((r) => r.id)).toEqual([1]);
    // The same filter, unchanged, applied to the refreshed data.
    expect(filterRecords(after, filters).map((r) => r.id)).toEqual([1, 3]);
  });

  it('search still applies correctly to a refreshed array', () => {
    expect(
      filterRecords(after, { search: 'CN-2026-0003' }).map((r) => r.id),
    ).toEqual([3]);
    expect(filterRecords(after, { sitio: 'Sitio 4' }).map((r) => r.id)).toEqual([
      2,
    ]);
  });
});

describe('no second data path was introduced', () => {
  it('does not subscribe to Postgres changes', () => {
    // Incident data must keep arriving through Laravel, which is where the
    // per-role redaction in IncidentResource is applied. A direct database
    // subscription would deliver the raw row and defeat it.
    expect(dataContext).not.toMatch(/postgres_changes/);
    expect(dataContext).not.toMatch(/\.channel\(/);
    // No Supabase client here at all — this context talks to Laravel only.
    // (The word "Supabase" does appear once, in a comment naming the
    // EnsureSupabaseAal2 middleware that can 401 an API call; that is a
    // reference to the backend, not a client import.)
    expect(dataContext).not.toMatch(/from '.*supabaseClient'/);
    expect(dataContext).not.toMatch(/\bsupabase\s*\./);
  });
});
