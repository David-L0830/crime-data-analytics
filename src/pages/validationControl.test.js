import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CP-2 — the Validation control on Crime Data Collection.
 *
 * Two things have to stay true, and they are easy to break in opposite
 * directions:
 *
 *   1. The badge counts what the validator has NOT SEEN, not what is
 *      outstanding. Opening the control clears the badge and must leave every
 *      pending record exactly as pending as it was. A change that made the
 *      badge count `validationStatus === 'pending'` instead would look right
 *      on screen and be wrong: it would stop clearing, or worse, tempt
 *      somebody into clearing it by touching records.
 *   2. The control does not exist for an Encoder.
 *
 * WHAT THESE TESTS PROVE, AND WHAT THEY DO NOT
 * --------------------------------------------
 * Vitest runs in a Node environment with no DOM (see vitest.config.js), so the
 * button cannot be rendered and clicked here — the same constraint documented
 * in context/authMfaGate.test.js and pages/exportPendingState.test.js. Adding
 * jsdom for one checkpoint would mean a new dependency and a config change.
 *
 * So the unread-count RULE is tested for real as a pure predicate below, and
 * the wiring around it is pinned structurally, because structure is how this
 * regresses.
 */

const here = dirname(fileURLToPath(import.meta.url));
const incidentFeed = readFileSync(join(here, 'IncidentFeed.jsx'), 'utf8');
const dataContext = readFileSync(
  join(here, '..', 'context', 'DataContext.jsx'),
  'utf8',
);

// The exact predicate DataContext derives unreadValidationCount with.
const unreadValidation = (notifications) =>
  notifications.filter((n) => n.title === 'New Incident' && !n.read).length;

describe('the unread validation count', () => {
  const notifications = [
    { id: 1, title: 'New Incident', read: false },
    { id: 2, title: 'New Incident', read: false },
    { id: 3, title: 'New Incident', read: true },
    { id: 4, title: 'Hotspot Alert', read: false },
    { id: 5, title: 'Case Resolved', read: false },
  ];

  it('counts only unread New Incident announcements', () => {
    expect(unreadValidation(notifications)).toBe(2);
  });

  it('ignores other notification titles', () => {
    expect(
      unreadValidation([
        { id: 1, title: 'Hotspot Alert', read: false },
        { id: 2, title: 'Case Resolved', read: false },
      ]),
    ).toBe(0);
  });

  it('drops to zero once those notifications are marked read', () => {
    // What markAllNotificationsRead('New Incident') does to the list.
    const afterMarking = notifications.map((n) =>
      n.title === 'New Incident' ? { ...n, read: true } : n,
    );
    expect(unreadValidation(afterMarking)).toBe(0);
    // And it left the other titles alone, so the bell still shows them.
    expect(afterMarking.filter((n) => !n.read).map((n) => n.id)).toEqual([4, 5]);
  });

  it('rises again when a further incident is submitted', () => {
    const afterMarking = notifications.map((n) =>
      n.title === 'New Incident' ? { ...n, read: true } : n,
    );
    const afterNewSubmission = [
      { id: 6, title: 'New Incident', read: false },
      ...afterMarking,
    ];
    expect(unreadValidation(afterNewSubmission)).toBe(1);
  });

  it('is a READ count, not a workload count', () => {
    // Five pending records, but every announcement already seen: the badge is
    // zero while the queue is not. This distinction is the whole design.
    const records = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      validationStatus: 'pending',
    }));
    const allSeen = notifications.map((n) => ({ ...n, read: true }));

    expect(unreadValidation(allSeen)).toBe(0);
    expect(records.filter((r) => r.validationStatus === 'pending')).toHaveLength(
      5,
    );
  });
});

describe('DataContext derives the count without new machinery', () => {
  it('exposes unreadValidationCount', () => {
    expect(dataContext).toMatch(/const unreadValidationCount = useMemo\(/);
    expect(dataContext).toMatch(/^\s{4}unreadValidationCount,$/m);
  });

  it('uses the same shape as the existing unreadHotspotAlertCount', () => {
    const body = dataContext.slice(
      dataContext.indexOf('const unreadValidationCount = useMemo('),
      dataContext.indexOf('// ===== Crime types ====='),
    );
    expect(body).toMatch(
      /notifications\.filter\(\(n\) => n\.title === 'New Incident' && !n\.read\)/,
    );
    expect(body).toMatch(/\[notifications\]/);
  });

  it('adds no request, no endpoint and no second poll', () => {
    const body = dataContext.slice(
      dataContext.indexOf('const unreadValidationCount = useMemo('),
      dataContext.indexOf('// ===== Crime types ====='),
    );
    expect(body).not.toMatch(/Service\./);
    expect(body).not.toMatch(/api\./);
    expect(body).not.toMatch(/fetch\(/);
    // Still exactly one interval in the whole context (CP-1's).
    expect(dataContext.match(/setInterval\(/g)).toHaveLength(1);
  });
});

describe('the Validation control is permission gated', () => {
  it('renders only when the validate_record permission is held', () => {
    expect(incidentFeed).toMatch(/const canValidate = can\('validate_record'\)/);
    expect(incidentFeed).toMatch(/\{canValidate && \(\s*<Button/);
  });

  it('is not gated on anything an Encoder holds', () => {
    // The guard must be canValidate alone — not create_incident, and not an
    // `||` that would let another permission in.
    const block = incidentFeed.slice(
      incidentFeed.indexOf('{canValidate && ('),
      incidentFeed.indexOf("{can('create_incident') && ("),
    );
    expect(block).not.toMatch(/create_incident/);
    expect(block).not.toMatch(/edit_own_incident/);
    expect(block).not.toMatch(/\|\|/);
  });

  it('sits in the header beside New Incident, not in a sidebar or a route', () => {
    expect(incidentFeed).toMatch(/Validation\n\s*\{unreadValidationCount > 0/);
    // CP-3's work, explicitly not done here.
    expect(incidentFeed).not.toMatch(/ValidationDrawer/);
    expect(incidentFeed).not.toMatch(/navigate\(.*validation/i);
  });
});

describe('the badge reuses the existing unread style', () => {
  it('uses .notif-bell-count rather than a new badge class', () => {
    const block = incidentFeed.slice(
      incidentFeed.indexOf('{canValidate && ('),
      incidentFeed.indexOf("{can('create_incident') && ("),
    );
    expect(block).toMatch(/className="notif-bell-count"/);
    expect(block).toMatch(/unreadValidationCount > 99 \? '99\+'/);
  });

  it('renders no badge at all when nothing is unread', () => {
    const block = incidentFeed.slice(
      incidentFeed.indexOf('{canValidate && ('),
      incidentFeed.indexOf("{can('create_incident') && ("),
    );
    expect(block).toMatch(/\{unreadValidationCount > 0 && \(/);
  });
});

describe('opening Validation reads notifications and nothing else', () => {
  const handler = incidentFeed.slice(
    incidentFeed.indexOf('const handleOpenValidation = async () => {'),
    incidentFeed.indexOf('const handleApprove = async (record) => {'),
  );

  it('calls the existing mark-all-read helper for New Incident', () => {
    expect(handler).toMatch(
      /await markAllNotificationsRead\('New Incident'\)/,
    );
  });

  it('touches no incident record', () => {
    // The failure this guards against is somebody "helpfully" clearing the
    // queue when the badge is cleared.
    expect(handler).not.toMatch(/approveRecord/);
    expect(handler).not.toMatch(/returnRecordForCorrection/);
    expect(handler).not.toMatch(/incidentService/);
    expect(handler).not.toMatch(/updateRecord/);
    expect(handler).not.toMatch(/archiveRecord/);
    expect(handler).not.toMatch(/setRecords/);
    expect(handler).not.toMatch(/validationStatus/);
    expect(handler).not.toMatch(/setViewing/);
  });

  it('guards against a double click and a pointless empty write', () => {
    expect(handler).toMatch(/if \(openingValidation\) return;/);
    expect(handler).toMatch(/if \(unreadValidationCount === 0\) return;/);
  });

  it('surfaces a failure instead of silently leaving the badge back', () => {
    expect(handler).toMatch(/showToast\(/);
    expect(handler).toMatch(/'error'/);
  });

  it('adds no new service function', () => {
    const service = readFileSync(
      join(here, '..', 'services', 'notificationService.js'),
      'utf8',
    );
    // markAllRead already took an optional title before CP-2.
    expect(service).toMatch(/markAllRead: \(title, token\) =>/);
  });
});

describe('CP-1 is left intact', () => {
  it('keeps the poll cadences and the combined tick', () => {
    expect(dataContext).toMatch(/const VISIBLE_POLL_MS = 30000;/);
    expect(dataContext).toMatch(/const HIDDEN_POLL_MS = 120000;/);
    expect(dataContext).toMatch(/const refreshPolledData = useCallback\(/);
    expect(dataContext).toMatch(
      /timer = setInterval\(refreshPolledData, intervalMs\)/,
    );
  });

  it('keeps the records refresh and its modal deferral', () => {
    expect(dataContext).toMatch(/const refreshRecords = useCallback\(/);
    expect(dataContext).toMatch(/const recordsFetchInFlight = useRef\(false\)/);
    expect(dataContext).toMatch(/const recordsRefreshHeld = useRef\(false\)/);
    expect(dataContext).toMatch(/const recordsRefreshMissed = useRef\(false\)/);
    expect(incidentFeed).toMatch(
      /holdRecordsRefresh\(Boolean\(viewing \|\| editing \|\| creating\)\)/,
    );
  });
});
