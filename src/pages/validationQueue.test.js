import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CP-23 — the validation queue.
 *
 * The queue must be a view of REAL records and must reuse the existing review
 * machinery rather than growing a second one. Two duplicate incident viewers,
 * or a second pair of approve/return calls, would drift apart from the guards
 * that make validation trustworthy (2C, 2D, 2F) — those live on the server and
 * are reached through exactly one path.
 *
 * DOM caveat as elsewhere in this suite: Vitest runs in a Node environment, so
 * the modal cannot be rendered. The filtering rule is tested as a real pure
 * function; the reuse and the absence of duplication are pinned structurally.
 */

const here = dirname(fileURLToPath(import.meta.url));
const incidentFeed = readFileSync(join(here, 'IncidentFeed.jsx'), 'utf8');
const queueModal = readFileSync(
  join(here, '..', 'components', 'incidents', 'ValidationQueueModal.jsx'),
  'utf8',
);

// The file's own comments EXPLAIN that review happens in IncidentViewModal and
// that this component holds no approve/return controls. Asserting those names
// are absent has to read the executable text, or the explanation would fail the
// test it exists to describe. Same approach as pages/exportMetadata.test.js.
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const queueModalCode = stripComments(queueModal);

// The derivation IncidentFeed hands to the queue.
const buildQueue = (records) => {
  const active = records.filter((r) => r.status !== 'Archived');
  return {
    pending: active.filter((r) => r.validationStatus === 'pending'),
    returned: active.filter((r) => r.validationStatus === 'returned'),
  };
};

const records = [
  { id: 1, caseNumber: 'A-1', status: 'Open', validationStatus: 'pending' },
  {
    id: 2,
    caseNumber: 'A-2',
    status: 'Under Investigation',
    validationStatus: 'pending',
  },
  { id: 3, caseNumber: 'A-3', status: 'Open', validationStatus: 'validated' },
  {
    id: 4,
    caseNumber: 'A-4',
    status: 'Open',
    validationStatus: 'returned',
    correctionReason: 'Sitio is wrong',
  },
  { id: 5, caseNumber: 'A-5', status: 'Archived', validationStatus: 'pending' },
  { id: 6, caseNumber: 'A-6', status: 'Archived', validationStatus: 'returned' },
];

describe('queue contents', () => {
  const queue = buildQueue(records);

  it('puts active pending records in Pending Validation', () => {
    expect(queue.pending.map((r) => r.id)).toEqual([1, 2]);
  });

  it('puts active returned records in Returned for Correction', () => {
    expect(queue.returned.map((r) => r.id)).toEqual([4]);
  });

  it('excludes validated records from both tabs', () => {
    expect([...queue.pending, ...queue.returned].map((r) => r.id)).not.toContain(
      3,
    );
  });

  it('excludes archived records from both tabs', () => {
    const ids = [...queue.pending, ...queue.returned].map((r) => r.id);
    expect(ids).not.toContain(5);
    expect(ids).not.toContain(6);
  });

  it('keeps the correction reason available on returned records', () => {
    expect(queue.returned[0].correctionReason).toBe('Sitio is wrong');
  });

  it('never lists the same record in both tabs', () => {
    const pendingIds = new Set(queue.pending.map((r) => r.id));
    expect(queue.returned.some((r) => pendingIds.has(r.id))).toBe(false);
  });

  it('introduces no duplicate rows', () => {
    const ids = [...queue.pending, ...queue.returned].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('empties a tab as records are acted on', () => {
    const afterApproval = records.map((r) =>
      r.id === 1 ? { ...r, validationStatus: 'validated' } : r,
    );
    expect(buildQueue(afterApproval).pending.map((r) => r.id)).toEqual([2]);

    const afterReturn = afterApproval.map((r) =>
      r.id === 2 ? { ...r, validationStatus: 'returned' } : r,
    );
    const q = buildQueue(afterReturn);
    expect(q.pending).toHaveLength(0);
    expect(q.returned.map((r) => r.id)).toEqual([2, 4]);
  });
});

describe('the queue reuses existing components', () => {
  it('uses the shared Modal shell rather than a bespoke overlay', () => {
    expect(queueModal).toMatch(/import Modal from '\.\.\/ui\/Modal'/);
    expect(queueModal).toMatch(/<Modal/);
  });

  it('uses the shared Table and ValidationBadge', () => {
    expect(queueModal).toMatch(/import Table from '\.\.\/ui\/Table'/);
    expect(queueModal).toMatch(
      /import ValidationBadge from '\.\.\/ui\/ValidationBadge'/,
    );
  });

  it('contains no incident viewer of its own', () => {
    // The single most important property of this file: reviewing goes through
    // IncidentViewModal, which owns ValidationPanel and the approve/return
    // controls. A second viewer here would be a second place for the rules to
    // drift.
    expect(queueModalCode).not.toMatch(/IncidentViewModal/);
    expect(queueModalCode).not.toMatch(/ValidationPanel/);
    expect(queueModalCode).not.toMatch(/approveRecord/);
    expect(queueModalCode).not.toMatch(/returnRecordForCorrection/);
    // The help text names "Validate Record" on purpose, to point the reviewer
    // at where the control actually is — so the check that matters is that
    // the only thing this component can DO is hand a record back.
    expect(queueModalCode.match(/onClick=/g)).toHaveLength(2);
    expect(queueModalCode).toMatch(/onClick=\{\(\) => onOpenRecord\(row\)\}/);
  });

  it('hands the record back to the page instead of acting on it', () => {
    expect(queueModal).toMatch(/onOpenRecord\(row\)/);
  });

  it('shows the correction reason column on the returned tab only', () => {
    expect(queueModal).toMatch(/if \(tab === 'returned'\)/);
    expect(queueModal).toMatch(/key: 'correctionReason'/);
  });
});

describe('review flow through the existing modal', () => {
  it('opening a queue row closes the queue and opens IncidentViewModal', () => {
    const fn = incidentFeed.slice(
      incidentFeed.indexOf('const handleReviewFromQueue'),
      incidentFeed.indexOf('const handleCloseViewing'),
    );
    // Queue closes first: two open modals would mean two competing focus
    // traps, and Modal restores focus to whatever opened it.
    expect(fn).toMatch(/setValidationOpen\(false\)/);
    expect(fn).toMatch(/setViewing\(record\)/);
  });

  it('returns to the queue when the record is closed', () => {
    const fn = incidentFeed.slice(
      incidentFeed.indexOf('const handleCloseViewing'),
      incidentFeed.indexOf('const handleApprove'),
    );
    expect(fn).toMatch(/setViewing\(null\)/);
    expect(fn).toMatch(/if \(returnToQueue\)/);
    expect(fn).toMatch(/setValidationOpen\(true\)/);
  });

  it('does not bounce back to the queue when the user chose to edit', () => {
    const fn = incidentFeed.slice(
      incidentFeed.indexOf('const handleEdit = (record)'),
      incidentFeed.indexOf('// In this UI only BADAC Administrator'),
    );
    expect(fn).toMatch(/setReturnToQueue\(false\)/);
  });

  it('still routes approve and return through the existing actions', () => {
    // Unchanged from before this checkpoint — the endpoints and their
    // server-side guards remain the authority.
    expect(incidentFeed).toMatch(/await approveRecord\(record\.id\)/);
    expect(incidentFeed).toMatch(
      /await returnRecordForCorrection\(record\.id, reason\)/,
    );
    expect(incidentFeed).toMatch(/onApprove=\{canValidate \? handleApprove : null\}/);
    expect(incidentFeed).toMatch(/onReturn=\{canValidate \? handleReturn : null\}/);
  });

  it('surfaces a refusal from the server rather than swallowing it', () => {
    // How the 2D/2F 403s reach the validator.
    const fn = incidentFeed.slice(
      incidentFeed.indexOf('const handleApprove'),
      incidentFeed.indexOf('const handleReturn'),
    );
    expect(fn).toMatch(/catch \(err\)/);
    expect(fn).toMatch(/showToast\(/);
    expect(fn).toMatch(/'error'/);
  });
});

describe('the queue is permission gated', () => {
  it('is mounted only for a caller who may validate', () => {
    expect(incidentFeed).toMatch(/\{canValidate && \(\s*<ValidationQueueModal/);
  });
});

describe('no backend surface was added', () => {
  it('the queue calls no endpoint of its own', () => {
    expect(queueModal).not.toMatch(/\/incidents/);
    expect(queueModal).not.toMatch(/PUT|POST|DELETE/);
    expect(queueModal).not.toMatch(/axios/);
  });
});
