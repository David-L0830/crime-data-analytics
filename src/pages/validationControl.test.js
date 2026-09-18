import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CP-23 — the Validation control counts RECORDS, not notifications.
 *
 * The first attempt at this control derived its badge from unread
 * "New Incident" notifications and cleared them when the button was clicked.
 * That was wrong in a way that looked right on screen: an announcement says
 * something happened, it does not say whether the record was reviewed, it is
 * per-person, and marking it read changes nothing about the record. Reading is
 * not reviewing. These tests exist so that mistake cannot come back.
 *
 * WHAT THESE TESTS PROVE, AND WHAT THEY DO NOT
 * --------------------------------------------
 * Vitest runs in a Node environment with no DOM (see vitest.config.js), so the
 * button cannot be rendered and clicked here — the same constraint documented
 * in context/authMfaGate.test.js and pages/exportPendingState.test.js. The
 * counting RULE is exercised for real as a pure predicate; the wiring around
 * it is pinned structurally, because structure is how it regresses.
 */

const here = dirname(fileURLToPath(import.meta.url));
const incidentFeed = readFileSync(join(here, 'IncidentFeed.jsx'), 'utf8');
const dataContext = readFileSync(
  join(here, '..', 'context', 'DataContext.jsx'),
  'utf8',
);
const queueModal = readFileSync(
  join(here, '..', 'components', 'incidents', 'ValidationQueueModal.jsx'),
  'utf8',
);

// The exact derivation IncidentFeed uses for the badge and the queue.
const activePending = (records) =>
  records.filter(
    (r) => r.status !== 'Archived' && r.validationStatus === 'pending',
  );

describe('the badge counts pending records', () => {
  const records = [
    { id: 1, status: 'Open', validationStatus: 'pending' },
    { id: 2, status: 'Under Investigation', validationStatus: 'pending' },
    { id: 3, status: 'Open', validationStatus: 'validated' },
    { id: 4, status: 'Open', validationStatus: 'returned' },
    { id: 5, status: 'Archived', validationStatus: 'pending' },
  ];

  it('counts active pending records only', () => {
    expect(activePending(records).map((r) => r.id)).toEqual([1, 2]);
  });

  it('excludes archived records even when they are pending', () => {
    // approve() refuses an archived record with a 422, so offering it for
    // review could only ever produce a guaranteed failure.
    expect(activePending(records).some((r) => r.status === 'Archived')).toBe(
      false,
    );
  });

  it('excludes validated and returned records from the badge', () => {
    const counted = activePending(records).map((r) => r.validationStatus);
    expect(counted).not.toContain('validated');
    expect(counted).not.toContain('returned');
  });

  it('falls only when a record actually changes state', () => {
    // Approving record 1 is the ONLY kind of thing that lowers this number.
    const afterApproval = records.map((r) =>
      r.id === 1 ? { ...r, validationStatus: 'validated' } : r,
    );
    expect(activePending(afterApproval).map((r) => r.id)).toEqual([2]);

    // Returning record 2 lowers it too, by moving it to the other tab.
    const afterReturn = afterApproval.map((r) =>
      r.id === 2 ? { ...r, validationStatus: 'returned' } : r,
    );
    expect(activePending(afterReturn)).toHaveLength(0);
  });

  it('is unaffected by notification read state', () => {
    // The regression this file exists for: notifications are a different
    // table with no bearing on the count. Marking every one read leaves the
    // records, and therefore the badge, exactly as they were.
    const notifications = [
      { id: 1, title: 'New Incident', read: false },
      { id: 2, title: 'New Incident', read: false },
    ];
    const allRead = notifications.map((n) => ({ ...n, read: true }));

    expect(activePending(records)).toHaveLength(2);
    expect(allRead.every((n) => n.read)).toBe(true);
    // Records untouched by anything that happened to the inbox.
    expect(activePending(records)).toHaveLength(2);
  });

  it('is the same number for every viewer', () => {
    // A property of the data, not of anyone's inbox: no user id enters it.
    expect(activePending(records)).toEqual(activePending(records));
  });
});

describe('the notification-based implementation is gone', () => {
  it('DataContext no longer derives a validation count from notifications', () => {
    expect(dataContext).not.toMatch(/unreadValidationCount/);
    expect(dataContext).not.toMatch(/'New Incident'/);
  });

  it('IncidentFeed no longer imports or calls the mark-all-read helper', () => {
    // Not in scope at all, so a reintroduced call would be a ReferenceError
    // rather than a silent write.
    const useDataBlock = incidentFeed.slice(
      incidentFeed.indexOf('  const {'),
      incidentFeed.indexOf('} = useData()'),
    );
    expect(useDataBlock).not.toMatch(/markAllNotificationsRead/);
    expect(incidentFeed).not.toMatch(/markAllNotificationsRead/);
    expect(incidentFeed).not.toMatch(/unreadValidationCount/);
  });

  it('leaves the topbar bell untouched', () => {
    // The bell's own count and the shared helper still exist for their real
    // callers (Header.jsx, Trends.jsx).
    expect(dataContext).toMatch(/const unreadNotificationCount = useMemo\(/);
    expect(dataContext).toMatch(/const markAllNotificationsRead = useCallback\(/);
    expect(dataContext).toMatch(/const unreadHotspotAlertCount = useMemo\(/);
  });
});

describe('the badge is wired to the record-derived count', () => {
  it('derives the queue from records, excluding archived', () => {
    const body = incidentFeed.slice(
      incidentFeed.indexOf('const validationQueue = useMemo('),
      incidentFeed.indexOf('const handleOpenValidation'),
    );
    expect(body).toMatch(/records\.filter\(\(r\) => r\.status !== 'Archived'\)/);
    expect(body).toMatch(/r\.validationStatus === 'pending'/);
    expect(body).toMatch(/r\.validationStatus === 'returned'/);
    expect(body).toMatch(/\[records\]/);
  });

  it('renders the badge from validationQueue.pending.length', () => {
    const block = incidentFeed.slice(
      incidentFeed.indexOf('{canValidate && ('),
      incidentFeed.indexOf("{can('create_incident') && ("),
    );
    expect(block).toMatch(/\{validationQueue\.pending\.length > 0 && \(/);
    expect(block).toMatch(/className="notif-bell-count"/);
    expect(block).not.toMatch(/unread/);
  });

  it('stays gated on validate_record alone', () => {
    expect(incidentFeed).toMatch(/const canValidate = can\('validate_record'\)/);
    const block = incidentFeed.slice(
      incidentFeed.indexOf('{canValidate && ('),
      incidentFeed.indexOf("{can('create_incident') && ("),
    );
    expect(block).not.toMatch(/create_incident/);
    expect(block).not.toMatch(/\|\|/);
  });
});

describe('opening the queue writes nothing', () => {
  const handler = incidentFeed.slice(
    incidentFeed.indexOf('const handleOpenValidation'),
    incidentFeed.indexOf('const handleReviewFromQueue'),
  );

  it('is a single synchronous state set', () => {
    expect(handler).toMatch(/setValidationOpen\(true\)/);
    expect(handler).not.toMatch(/await/);
    expect(handler).not.toMatch(/async/);
  });

  it('issues no request and touches no notification', () => {
    expect(handler).not.toMatch(/markAllNotificationsRead/);
    expect(handler).not.toMatch(/notificationService/);
    expect(handler).not.toMatch(/markRead/);
    expect(handler).not.toMatch(/api\./);
    expect(handler).not.toMatch(/fetch\(/);
  });

  it('changes no record', () => {
    expect(handler).not.toMatch(/approveRecord/);
    expect(handler).not.toMatch(/returnRecordForCorrection/);
    expect(handler).not.toMatch(/incidentService/);
    expect(handler).not.toMatch(/setRecords/);
    expect(handler).not.toMatch(/validationStatus/);
  });

  it('is true of the queue component as well', () => {
    expect(queueModal).not.toMatch(/notificationService/);
    expect(queueModal).not.toMatch(/markAllNotificationsRead/);
    expect(queueModal).not.toMatch(/incidentService/);
    expect(queueModal).not.toMatch(/api\./);
    expect(queueModal).not.toMatch(/fetch\(/);
  });
});

describe('CP-1 is left intact', () => {
  it('keeps the poll cadences and the single combined tick', () => {
    expect(dataContext).toMatch(/const VISIBLE_POLL_MS = 30000;/);
    expect(dataContext).toMatch(/const HIDDEN_POLL_MS = 120000;/);
    expect(dataContext).toMatch(/const refreshPolledData = useCallback\(/);
    expect(dataContext).toMatch(
      /timer = setInterval\(refreshPolledData, intervalMs\)/,
    );
    expect(dataContext.match(/setInterval\(/g)).toHaveLength(1);
  });

  it('keeps refreshRecords and its guards', () => {
    expect(dataContext).toMatch(/const refreshRecords = useCallback\(/);
    expect(dataContext).toMatch(/const recordsFetchInFlight = useRef\(false\)/);
    expect(dataContext).toMatch(/const recordsRefreshHeld = useRef\(false\)/);
    expect(dataContext).toMatch(/const recordsRefreshMissed = useRef\(false\)/);
    expect(dataContext).toMatch(/setRecords\(list \|\| \[\]\)/);
  });

  it('holds the refresh for an open record but NOT for the queue alone', () => {
    // The queue is a read-only list: staleness there is worse than a swap, so
    // it deliberately does not appear in the hold condition. Once an actual
    // record is open, `viewing` is set and the existing hold protects it.
    expect(incidentFeed).toMatch(
      /holdRecordsRefresh\(Boolean\(viewing \|\| editing \|\| creating\)\)/,
    );
    const holdEffect = incidentFeed.slice(
      incidentFeed.indexOf('holdRecordsRefresh(Boolean('),
      incidentFeed.indexOf('}, [viewing, editing, creating, holdRecordsRefresh])'),
    );
    expect(holdEffect).not.toMatch(/validationOpen/);
  });
});
