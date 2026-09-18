import { describe, expect, it, vi } from 'vitest';

/**
 * logExport() — the call every export surface makes after a download has
 * actually succeeded.
 *
 * Behavioural, against a stubbed api. Two properties matter here and neither is
 * visible from reading a call site:
 *
 *  * The optional scope metadata must flatten into the same payload as the
 *    report key, and omitting it must leave the request exactly as it was
 *    before that argument existed — every surface outside the four wired ones
 *    still calls logExport('key') alone, and those calls must keep working
 *    unchanged.
 *
 *  * The call must never be able to fail a download. It is bookkeeping that
 *    runs after the file is already in the user's hands.
 */

async function load({ rejects = false } = {}) {
  vi.resetModules();
  const post = rejects
    ? vi.fn().mockRejectedValue(new Error('500'))
    : vi.fn().mockResolvedValue({});
  vi.doMock('./api', () => ({ api: { post, get: vi.fn() } }));
  const { auditLogService } = await import('./auditLogService');
  return { auditLogService, post };
}

describe('logExport records a report export', () => {
  it('posts only the report key when no metadata is given', async () => {
    const { auditLogService, post } = await load();

    await auditLogService.logExport('dashboard');

    expect(post).toHaveBeenCalledWith('/report-export-audit', {
      report: 'dashboard',
    });
  });

  it('flattens the scope metadata alongside the key', async () => {
    const { auditLogService, post } = await load();

    await auditLogService.logExport('mapping', {
      rowCount: 12,
      periodFrom: '2026-01-01',
      periodTo: '2026-01-31',
      filtersSummary: 'Sitio: Sitio 1',
    });

    expect(post).toHaveBeenCalledWith('/report-export-audit', {
      report: 'mapping',
      rowCount: 12,
      periodFrom: '2026-01-01',
      periodTo: '2026-01-31',
      filtersSummary: 'Sitio: Sitio 1',
    });
  });

  it('leaves a summary within the limit exactly as written', async () => {
    const { auditLogService, post } = await load();
    const summary = 'x'.repeat(500);

    await auditLogService.logExport('mapping', { filtersSummary: summary });

    expect(post.mock.calls[0][1].filtersSummary).toBe(summary);
  });

  it('trims a summary that would fail the server-side 500-character rule', async () => {
    // The audit row and the report_runs row are written in one transaction, so
    // a 422 on the summary would cost the audit record too. Trimmed rather
    // than allowed to reject the request.
    const { auditLogService, post } = await load();

    await auditLogService.logExport('mapping', {
      rowCount: 1,
      filtersSummary: 'x'.repeat(640),
    });

    const sent = post.mock.calls[0][1].filtersSummary;
    expect(sent).toHaveLength(500);
    expect(sent.endsWith('…')).toBe(true);
    // The rest of the metadata is untouched by the trim.
    expect(post.mock.calls[0][1].rowCount).toBe(1);
  });

  it('swallows a failed recording, so a completed download still succeeds', async () => {
    const { auditLogService } = await load({ rejects: true });

    await expect(
      auditLogService.logExport('mapping', { rowCount: 3 }),
    ).resolves.toBeUndefined();
  });
});
