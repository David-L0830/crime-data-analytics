import { describe, it, expect, vi } from 'vitest';

// exceljs is dynamically imported inside exportWorkbook(), and this mock makes
// constructing a workbook throw. That is the only way to exercise the failure
// branch honestly: the alternative — asserting the branch by reading the
// source — would pass whether or not the code was fixed.
//
// The mock is module-level, so every test in this file runs against an exceljs
// that cannot build. The zero-row case is unaffected because it returns before
// the workbook is ever constructed.
vi.mock('exceljs', () => ({
  default: {
    Workbook: class {
      constructor() {
        throw new Error('exceljs unavailable');
      }
    },
  },
}));

const { exportWorkbook } = await import('./exportWorkbook.js');

// A minimal, valid call. Individual tests override `rows`.
const call = (overrides) =>
  exportWorkbook({
    filename: 'test.xlsx',
    sheetName: 'Test',
    title: 'Test Report',
    columns: [{ header: 'Case', key: 'caseNumber' }],
    rows: [{ caseNumber: 'CN-2026-0001' }],
    ...overrides,
  });

// ---------------------------------------------------------------------------
// A genuinely empty dataset and a failed export are different events, and the
// user is entitled to be told which one happened.
//
// exportWorkbook used to have a single `onEmpty` callback and called it from
// both places — the early return for zero rows AND the catch around the
// workbook build. Six of the nine export surfaces pass "No data to export"
// there, so an exceljs failure or a write error told the user their data was
// empty. It was not: the export broke, and the records were sitting right in
// front of them.
// ---------------------------------------------------------------------------
describe('exportWorkbook — empty data vs export failure', () => {
  it('calls onEmpty for zero rows', async () => {
    const onEmpty = vi.fn();
    const onError = vi.fn();

    const result = await call({ rows: [], onEmpty, onError });

    expect(onEmpty).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('calls onEmpty when rows is missing entirely', async () => {
    const onEmpty = vi.fn();
    const onError = vi.fn();

    const result = await call({ rows: undefined, onEmpty, onError });

    expect(onEmpty).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('calls onError when building the workbook throws', async () => {
    const onEmpty = vi.fn();
    const onError = vi.fn();

    const result = await call({ onEmpty, onError });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it('does NOT call onEmpty when the export fails', async () => {
    // The defect, stated directly: a real failure must never be reported as
    // "no data". Six surfaces word onEmpty as "No data to export".
    const onEmpty = vi.fn();
    const onError = vi.fn();

    await call({ onEmpty, onError });

    expect(onEmpty).not.toHaveBeenCalled();
  });

  it('still returns false on failure, so callers skip their success path', async () => {
    // auditLogService.logExport() and the success toast are both gated on a
    // true return. A failed export must not be audited as REPORT_EXPORTED.
    const result = await call({ onEmpty: vi.fn(), onError: vi.fn() });

    expect(result).toBe(false);
  });

  it('does not throw when a caller omits the callbacks', async () => {
    // Both callbacks are optional; omitting them must not turn a handled
    // failure into an unhandled one.
    await expect(call({ rows: [] })).resolves.toBe(false);
    await expect(call({})).resolves.toBe(false);
  });
});
