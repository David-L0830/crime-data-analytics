import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '../utils/constants';

/**
 * CP-4 — Crime Data Collection shows OFFICIAL records by default.
 *
 * Before this checkpoint the incident list showed every active record
 * regardless of validation state, which meant an unreviewed encoding sat in
 * the official list — and in its exports and printed reports — looking
 * exactly like a validated one. Validation only means something if the
 * validated set is the set people actually read.
 *
 * TWO QUESTIONS, DELIBERATELY KEPT APART
 * --------------------------------------
 *   permitted      — what a viewer may EVER see on this page.
 *   defaultVisible — what shows when no Validation filter is chosen.
 *
 * Collapsing them would break the audit path: a BADAC Administrator choosing
 * "Pending Validation" from the existing filter would get an empty table,
 * because the default rule would have removed those records before the
 * explicit request was ever considered. Separating them also keeps the
 * Encoder's ownership restriction ABSOLUTE — selecting a filter must never
 * become a way to see another Encoder's unvalidated work.
 *
 * DOM caveat, as everywhere in this suite: Vitest runs in a Node environment
 * (vitest.config.js), so the page cannot be rendered. The rule itself is
 * exercised as a real pure function against real PERMISSIONS data; the wiring
 * that puts it in the pipeline is pinned structurally, because structure is
 * how it regresses.
 */

const here = dirname(fileURLToPath(import.meta.url));
const incidentFeed = readFileSync(join(here, 'IncidentFeed.jsx'), 'utf8');
const helpers = readFileSync(join(here, '..', 'utils', 'helpers.js'), 'utf8');

// This file's own comments name `permitted`, `defaultVisible` and `reportedBy`
// while explaining them, so the checks below must read executable text only.
// Same approach as pages/exportMetadata.test.js and pages/validationQueue.test.js.
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const code = stripComments(incidentFeed);

const between = (source, from, to) =>
  source.slice(source.indexOf(from), source.indexOf(to));

// ---------------------------------------------------------------------------
// The rule, mirrored from IncidentFeed's `filtered` memo. `can` is the real
// one: AuthContext looks the role up in PERMISSIONS, so this cannot pass by
// restating an RBAC assumption that the app does not actually hold.
// ---------------------------------------------------------------------------
const can = (role, permission) => (PERMISSIONS[role] || []).includes(permission);

const visibleTo = (rows, role, userId, validationKey = null) => {
  const canAuditValidation = can(role, 'validate_record');
  const isOwningEncoder = can(role, 'edit_own_incident');
  const ownedByViewer = (r) =>
    isOwningEncoder && Boolean(r.reportedBy) && r.reportedBy === userId;
  const permitted = (r) =>
    r.validationStatus === 'validated' || canAuditValidation || ownedByViewer(r);
  const defaultVisible = (r) =>
    r.validationStatus === 'validated' || ownedByViewer(r);

  // The archive rule already ran by this point in the real pipeline.
  const active = rows.filter((r) => r.status !== 'Archived');
  return validationKey
    ? active.filter((r) => r.validationStatus === validationKey && permitted(r))
    : active.filter(defaultVisible);
};

const ids = (rows) => rows.map((r) => r.id);

// reportedBy is a STRING: IncidentResource casts `(string) $this->reported_by`,
// UserResource casts `(string) $this->id`. The fixtures use the wire shape.
const ENCODER_A = '7';
const ENCODER_B = '9';

const records = [
  { id: 1, status: 'Open', validationStatus: 'validated', reportedBy: ENCODER_A },
  { id: 2, status: 'Open', validationStatus: 'validated', reportedBy: ENCODER_B },
  { id: 3, status: 'Open', validationStatus: 'pending', reportedBy: ENCODER_A },
  { id: 4, status: 'Open', validationStatus: 'pending', reportedBy: ENCODER_B },
  { id: 5, status: 'Open', validationStatus: 'returned', reportedBy: ENCODER_A },
  { id: 6, status: 'Open', validationStatus: 'returned', reportedBy: ENCODER_B },
  {
    id: 7,
    status: 'Archived',
    validationStatus: 'validated',
    reportedBy: ENCODER_A,
  },
  {
    id: 8,
    status: 'Archived',
    validationStatus: 'pending',
    reportedBy: ENCODER_A,
  },
  { id: 9, status: 'Open', validationStatus: 'validated', reportedBy: null },
  { id: 10, status: 'Open', validationStatus: 'pending', reportedBy: null },
];

describe('the default list is the official record list', () => {
  it('hides pending records from a BADAC Administrator', () => {
    const seen = ids(visibleTo(records, 'badac_admin', '1'));
    expect(seen).not.toContain(3);
    expect(seen).not.toContain(4);
    expect(seen).not.toContain(10);
  });

  it('hides returned records from a BADAC Administrator', () => {
    const seen = ids(visibleTo(records, 'badac_admin', '1'));
    expect(seen).not.toContain(5);
    expect(seen).not.toContain(6);
  });

  it('hides pending and returned records from a BADAC Validator', () => {
    // The Validator reviews through the Validation queue, which is a separate
    // view of `records`. Duplicating the backlog in the official list would
    // defeat the separation the queue exists for.
    expect(ids(visibleTo(records, 'badac_validator', '2'))).toEqual([1, 2, 9]);
  });

  it('shows validated records to every role', () => {
    for (const role of ['badac_admin', 'badac_validator', 'encoder']) {
      const seen = ids(visibleTo(records, role, ENCODER_A));
      expect(seen).toContain(1);
      expect(seen).toContain(2);
    }
  });

  it('shows an Encoder their own pending record', () => {
    expect(ids(visibleTo(records, 'encoder', ENCODER_A))).toContain(3);
  });

  it('shows an Encoder their own returned record', () => {
    // Without this the correction request would be invisible to the only
    // person who can act on it.
    expect(ids(visibleTo(records, 'encoder', ENCODER_A))).toContain(5);
  });

  it('does NOT show an Encoder another Encoder’s unvalidated work', () => {
    const seen = ids(visibleTo(records, 'encoder', ENCODER_A));
    expect(seen).not.toContain(4);
    expect(seen).not.toContain(6);
    expect(seen).toEqual([1, 2, 3, 5, 9]);
  });

  it('matches nobody when a record has no creator', () => {
    // `null === '7'` is false, so an ownerless unvalidated record stays
    // hidden from Encoders — the backend's own reported_by semantics.
    expect(ids(visibleTo(records, 'encoder', ENCODER_A))).not.toContain(10);
    expect(ids(visibleTo(records, 'encoder', null))).not.toContain(10);
  });

  it('keeps the archive rule ahead of it', () => {
    const seen = ids(visibleTo(records, 'badac_admin', '1'));
    expect(seen).not.toContain(7);
    expect(seen).not.toContain(8);
  });
});

describe('an explicit Validation filter opens the audit path', () => {
  it('lets a BADAC Administrator see ALL pending records', () => {
    expect(ids(visibleTo(records, 'badac_admin', '1', 'pending'))).toEqual([
      3, 4, 10,
    ]);
  });

  it('lets a BADAC Validator see ALL returned records', () => {
    expect(ids(visibleTo(records, 'badac_validator', '2', 'returned'))).toEqual([
      5, 6,
    ]);
  });

  it('does not let the default rule silently outrank the filter', () => {
    // The regression this split exists to prevent: applying the default
    // unconditionally would leave this empty for the two roles whose job it is.
    expect(visibleTo(records, 'badac_admin', '1', 'pending')).not.toHaveLength(
      0,
    );
    expect(
      visibleTo(records, 'badac_validator', '2', 'pending'),
    ).not.toHaveLength(0);
  });

  it('keeps an Encoder ownership-bound even when they select a filter', () => {
    // Selecting a filter must never become a way around ownership.
    expect(ids(visibleTo(records, 'encoder', ENCODER_A, 'pending'))).toEqual([
      3,
    ]);
    expect(ids(visibleTo(records, 'encoder', ENCODER_A, 'returned'))).toEqual([
      5,
    ]);
  });

  it('still excludes archived records under an explicit filter', () => {
    expect(
      ids(visibleTo(records, 'badac_admin', '1', 'pending')),
    ).not.toContain(8);
  });

  it('shows validated records to an Encoder they did not encode', () => {
    expect(ids(visibleTo(records, 'encoder', ENCODER_A, 'validated'))).toEqual([
      1, 2, 9,
    ]);
  });
});

describe('the RBAC facts this rule stands on', () => {
  it('grants validate_record to Administrator and Validator only', () => {
    expect(can('badac_admin', 'validate_record')).toBe(true);
    expect(can('badac_validator', 'validate_record')).toBe(true);
    expect(can('encoder', 'validate_record')).toBe(false);
  });

  it('grants edit_own_incident to the Encoder alone', () => {
    // This is what discriminates "may see their own unvalidated work".
    expect(can('encoder', 'edit_own_incident')).toBe(true);
    expect(can('badac_admin', 'edit_own_incident')).toBe(false);
    expect(can('badac_validator', 'edit_own_incident')).toBe(false);
  });

  it('is a frontend rule only — the server remains the authority', () => {
    // Stated, not assumed: CP-4 changed no route, middleware or controller.
    expect(code).not.toMatch(/role:badac/);
  });
});

describe('the rule is wired into the filtering pipeline', () => {
  const memo = between(code, 'const filtered = useMemo(', 'const { sort, sorted');

  it('defines both predicates inside the filtering memo', () => {
    expect(memo).toMatch(/const permitted = \(r\) =>/);
    expect(memo).toMatch(/const defaultVisible = \(r\) =>/);
  });

  it('applies defaultVisible when no Validation filter is chosen', () => {
    expect(memo).toMatch(/archiveRuled\.filter\(defaultVisible\)/);
  });

  it('applies permitted alongside an explicit Validation filter', () => {
    expect(memo).toMatch(
      /r\.validationStatus === validationKey && permitted\(r\)/,
    );
  });

  it('compares the ids directly, with no normalisation', () => {
    // Both sides are already strings on the wire; String()/Number() here
    // would be dead code hiding the real contract.
    expect(memo).toMatch(/r\.reportedBy === currentUserId/);
    expect(memo).not.toMatch(/String\(/);
    expect(memo).not.toMatch(/Number\(/);
  });

  it('runs after the archive rule, not instead of it', () => {
    expect(memo).toMatch(
      /const archiveRuled = filters\['inc-status'\][\s\S]*const permitted/,
    );
    expect(memo).toMatch(/r\.status !== 'Archived'/);
  });

  it('reads the role through can(), not the role string', () => {
    expect(code).toMatch(/const canAuditValidation = can\('validate_record'\)/);
    expect(code).toMatch(/const isOwningEncoder = can\('edit_own_incident'\)/);
    expect(code).not.toMatch(/currentUser\?\.role ===/);
  });

  it('lists the viewer in the memo dependencies', () => {
    // Without these the list would keep showing the previous account's scope
    // after a role change.
    const deps = between(code, '  }, [\n    records,', 'const { sort, sorted');
    expect(deps).toMatch(/currentUserId/);
    expect(deps).toMatch(/canAuditValidation/);
    expect(deps).toMatch(/isOwningEncoder/);
  });

  it('leaves the shared filterRecords helper alone', () => {
    // helpers.js also drives the Metabase-backed analytics pages; a validation
    // rule placed there would change them underneath this checkpoint.
    expect(helpers).not.toMatch(/validationStatus/);
  });
});

describe('the exported and printed document describe what they contain', () => {
  it('no longer claims "All" for an unfiltered list', () => {
    expect(code).not.toMatch(
      /Validation: \$\{filters\['inc-validation'\] \|\| 'All'\}/,
    );
    expect(code.match(/`Validation: \$\{validationScope\}`/g)).toHaveLength(2);
  });

  it('names the default scope for each kind of viewer', () => {
    expect(code).toMatch(/'Validated \+ own pending\/returned'/);
    expect(code).toMatch(/'Validated only'/);
  });

  it('still exports the same rows the table is showing', () => {
    // filtered -> sorted -> table and exportSpec: one array, so the file can
    // never contain a record the screen did not.
    expect(code).toMatch(/useTableSort\(filtered\)/);
    expect(code).toMatch(/^\s{4}rows: sorted,$/m);
    expect(code).toMatch(/rowCount: sorted\.length,/);
  });
});

describe('CP-23 is left intact', () => {
  const queueMemo = between(
    code,
    'const validationQueue = useMemo(',
    'const handleOpenValidation',
  );

  it('derives the queue from records, never from the filtered list', () => {
    // The point of the separation: hiding pending records from the official
    // list must NOT empty the queue that exists to clear them.
    expect(queueMemo).toMatch(
      /records\.filter\(\(r\) => r\.status !== 'Archived'\)/,
    );
    expect(queueMemo).toMatch(/\[records\]/);
    expect(queueMemo).not.toMatch(/filtered/);
    expect(queueMemo).not.toMatch(/sorted/);
    expect(queueMemo).not.toMatch(/permitted/);
    expect(queueMemo).not.toMatch(/defaultVisible/);
  });

  it('keeps the badge on the record-derived pending count', () => {
    expect(code).toMatch(/\{validationQueue\.pending\.length > 0 && \(/);
    expect(code).toMatch(/const canValidate = can\('validate_record'\)/);
  });

  it('still writes nothing when the queue is opened', () => {
    const handler = between(
      code,
      'const handleOpenValidation',
      'const handleReviewFromQueue',
    );
    expect(handler).toMatch(/setValidationOpen\(true\)/);
    expect(handler).not.toMatch(/markAllNotificationsRead/);
    expect(handler).not.toMatch(/incidentService/);
  });

  it('keeps the poll hold on open records only', () => {
    expect(code).toMatch(
      /holdRecordsRefresh\(Boolean\(viewing \|\| editing \|\| creating\)\)/,
    );
  });
});

describe('nothing else on the page changed', () => {
  it('keeps search, status, date and sitio filtering in filterRecords', () => {
    const call = between(
      code,
      'const results = filterRecords(records, {',
      'const archiveRuled',
    );
    for (const key of [
      'crimeType',
      'category',
      'sitio',
      'status',
      'dateFrom',
      'dateTo',
      'search',
    ]) {
      expect(call).toMatch(new RegExp(`${key}:`));
    }
  });

  it('keeps the Dashboard status-group hand-off', () => {
    expect(code).toMatch(/location\.state\?\.statusGroup/);
    expect(code).toMatch(/SOLVED_STATUSES\.includes\(r\.status\)/);
    expect(code).toMatch(/PENDING_STATUSES\.includes\(r\.status\)/);
  });

  it('keeps the Encoder edit gate on the very same comparison', () => {
    expect(code).toMatch(
      /can\('edit_own_incident'\) && record\.reportedBy === currentUser\?\.id/,
    );
  });
});
