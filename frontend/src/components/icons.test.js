import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Icons } from './icons';

/**
 * Every `Icons.<Name>` in the source must exist on the Icons export.
 *
 * A missing key is not a build error: `Icons.analytics` is just `undefined`,
 * and the page only crashes when React tries to render it ("Element type is
 * invalid ... got: undefined"). That is how System Settings went down —
 * `analytics` exists in NAV_ICONS but not in Icons — and the landing redesign
 * briefly had two more (`FileText`, `Layers`, which Icons exposes only as
 * `Report` and `Cluster`). This scan turns that runtime crash into a test
 * failure that names the file and the key.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

// icons.jsx itself is skipped: it defines Icons, and its comments use
// `Icons.X` as placeholder notation.
const sourceFiles = readdirSync(SRC, { recursive: true })
  .map(String)
  .filter(
    (f) =>
      /\.jsx?$/.test(f) &&
      !f.endsWith('.test.js') &&
      !/(^|[\\/])icons\.jsx$/.test(f),
  );

describe('Icons references', () => {
  it('every Icons.<Name> used in src exists on the Icons export', () => {
    const missing = [];
    for (const file of sourceFiles) {
      const text = readFileSync(join(SRC, file), 'utf8');
      for (const [, name] of text.matchAll(/\bIcons\.([A-Za-z0-9_]+)/g)) {
        if (!Icons[name]) missing.push(`${relative(SRC, join(SRC, file))}: Icons.${name}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
