#!/usr/bin/env node
/**
 * Determines whether `application-colors` is writable on this Metabase OSS
 * instance, WITHOUT permanently changing it.
 *
 * WHY
 * ---
 * Metabase's whitelabel colour map routes a colour named `background` onto the
 * token behind the dashcard fill:
 *
 *     background: ["background-primary", "background_page-primary"]
 *
 * and the embed's default theme sets
 * `other.dashboard.card.backgroundColor = var(--mb-color-background_page-primary)`,
 * which becomes `--mb-color-bg-dashboard-card` — the navy card fill. The card
 * BORDER comes from a separate token (`border-neutral`), so recolouring only
 * `background` would replace the navy while leaving the native border intact.
 *
 * The embed reads the setting ungated on the client (`useSetting`), but the
 * SERVER may refuse to store it, since this instance reports whitelabel:false.
 * That is the single unknown this script answers.
 *
 * SAFETY — this is the whole point of the script
 * ----------------------------------------------
 *   - default mode is READ ONLY; it writes nothing at all
 *   - --probe saves the original to disk BEFORE writing anything, then restores
 *     it in a `finally` block, so the original comes back even if the write
 *     fails, the verify throws, or the process is interrupted (SIGINT/SIGTERM
 *     are trapped)
 *   - after restoring it reads the value back and deep-compares it to the
 *     original, and says loudly if they differ
 *   - --hold is the only mode that deliberately leaves the value changed, and
 *     it prints the exact restore command before exiting
 *   - --restore re-applies the most recent saved original
 *   - the API key is read from the environment, never logged, never stored
 *
 * MODES
 *   (no flags)   read and report the current value. Writes nothing.
 *   --probe      read -> save -> write test -> verify -> ALWAYS restore
 *   --hold       read -> save -> write test -> LEAVE IT (for visual checking)
 *   --restore    restore from the newest saved original
 *
 * ENVIRONMENT
 *   METABASE_API_KEY                  sent as the x-api-key header
 *   METABASE_USER / METABASE_PASSWORD fallback; POST /api/session
 *   METABASE_URL                      default http://localhost:3000
 */

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = resolve(HERE, 'backups');
const SETTING = 'application-colors';

// The one colour under test. #1b221a is --bg-card in the app's dark theme.
const TEST_VALUE = { background: '#1b221a' };

const BASE_URL = (process.env.METABASE_URL || 'http://localhost:3000').replace(
  /\/+$/,
  '',
);

const args = process.argv.slice(2);
const PROBE = args.includes('--probe');
const HOLD = args.includes('--hold');
const RESTORE = args.includes('--restore');

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

async function authHeaders() {
  const apiKey = process.env.METABASE_API_KEY;
  if (apiKey) return { 'x-api-key': apiKey };

  const user = process.env.METABASE_USER;
  const password = process.env.METABASE_PASSWORD;
  if (user && password) {
    const res = await fetch(`${BASE_URL}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password }),
    });
    if (!res.ok) {
      throw new Error(`POST /api/session failed: ${res.status}`);
    }
    const { id } = await res.json();
    return { 'X-Metabase-Session': id };
  }

  throw new Error(
    'No credentials. Set METABASE_API_KEY, or METABASE_USER and METABASE_PASSWORD.',
  );
}

async function readSetting(headers) {
  const res = await fetch(`${BASE_URL}/api/setting/${SETTING}`, { headers });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, raw: text };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = text;
  }
  return { ok: true, status: res.status, value };
}

async function writeSetting(headers, value) {
  const res = await fetch(`${BASE_URL}/api/setting/${SETTING}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  const raw = await res.text();
  return { ok: res.ok, status: res.status, raw };
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function saveOriginal(value) {
  await mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = resolve(BACKUP_DIR, `application-colors-${stamp}.json`);
  await writeFile(path, JSON.stringify(value ?? {}, null, 2), 'utf8');
  return path;
}

async function newestBackup() {
  const files = (await readdir(BACKUP_DIR)).filter(
    (f) => f.startsWith('application-colors-') && f.endsWith('.json'),
  );
  if (files.length === 0) throw new Error('No saved application-colors backup.');
  files.sort();
  return resolve(BACKUP_DIR, files[files.length - 1]);
}

async function main() {
  console.log();
  console.log(c.bold('Metabase application-colors probe'));
  console.log(`  target : ${BASE_URL}`);
  console.log(
    `  mode   : ${
      RESTORE
        ? c.cyan('RESTORE from saved backup')
        : HOLD
          ? c.yellow('HOLD (leaves the value changed)')
          : PROBE
            ? c.yellow('PROBE (writes, then always restores)')
            : c.green('READ ONLY (writes nothing)')
    }`,
  );
  console.log();

  const headers = await authHeaders();

  // ---------------------------------------------------------------- restore
  if (RESTORE) {
    const path = await newestBackup();
    const original = JSON.parse(await readFile(path, 'utf8'));
    console.log(`  restoring from ${path}`);
    console.log(`  value: ${JSON.stringify(original)}`);
    const put = await writeSetting(headers, original);
    console.log(`  PUT -> ${put.status} ${put.ok ? 'OK' : c.red(put.raw)}`);
    const back = await readSetting(headers);
    console.log(`  read back: ${JSON.stringify(back.value)}`);
    console.log(
      same(back.value, original)
        ? c.green('  RESTORED — matches the saved original exactly.')
        : c.red('  MISMATCH — value does not match the saved original.'),
    );
    return;
  }

  // ------------------------------------------------------------------- read
  const current = await readSetting(headers);
  if (!current.ok) {
    console.log(c.red(`  GET /api/setting/${SETTING} -> ${current.status}`));
    console.log(`  ${current.raw.slice(0, 300)}`);
    console.log();
    console.log(
      c.red('  Cannot read the setting. Nothing was written. Stopping.'),
    );
    process.exitCode = 1;
    return;
  }

  console.log(c.bold(`  CURRENT VALUE of ${SETTING}:`));
  console.log(`    ${JSON.stringify(current.value)}`);
  console.log(
    `    ${c.dim(
      `type=${Array.isArray(current.value) ? 'array' : typeof current.value}, keys=${
        current.value && typeof current.value === 'object'
          ? Object.keys(current.value).length
          : 'n/a'
      }`,
    )}`,
  );

  if (!PROBE && !HOLD) {
    console.log();
    console.log(c.green('  READ ONLY — nothing was written.'));
    console.log('  To test writability with an automatic restore:');
    console.log(
      c.dim('    METABASE_API_KEY=... node scripts/metabase-appearance-probe.mjs --probe'),
    );
    return;
  }

  // --------------------------------------------------------- save the original
  const backupPath = await saveOriginal(current.value);
  console.log();
  console.log(`  original saved -> ${backupPath}`);

  // Restore even if the process is interrupted partway through.
  let restored = false;
  const restore = async () => {
    if (restored) return;
    restored = true;
    const put = await writeSetting(headers, current.value);
    const back = await readSetting(headers);
    const exact = same(back.value, current.value);
    console.log();
    console.log(
      exact
        ? c.green(
            `  RESTORED to the exact original value: ${JSON.stringify(back.value)}`,
          )
        : c.red(
            `  RESTORE MISMATCH — now ${JSON.stringify(back.value)}, expected ${JSON.stringify(current.value)}. PUT status ${put.status}. Saved original: ${backupPath}`,
          ),
    );
  };

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      console.log(c.yellow(`\n  ${sig} received — restoring before exit…`));
      try {
        await restore();
      } finally {
        process.exit(130);
      }
    });
  }

  try {
    console.log();
    console.log(`  writing test value: ${JSON.stringify(TEST_VALUE)}`);
    const put = await writeSetting(headers, TEST_VALUE);
    console.log(`  PUT -> ${put.status}`);
    if (!put.ok) {
      console.log(`  body: ${put.raw.slice(0, 400)}`);
    }

    const after = await readSetting(headers);
    console.log(`  read back: ${JSON.stringify(after.value)}`);

    const stuck =
      after.ok &&
      after.value &&
      typeof after.value === 'object' &&
      after.value.background === TEST_VALUE.background;

    console.log();
    if (stuck) {
      console.log(
        c.green(
          '  VERDICT: application-colors IS writable and persisted on this instance.',
        ),
      );
      console.log(
        '  The embed reads it ungated, so recolouring the card fill should work.',
      );
    } else {
      console.log(
        c.red(
          '  VERDICT: the value did NOT persist — this path is closed on this instance.',
        ),
      );
    }
  } finally {
    if (HOLD) {
      console.log();
      console.log(
        c.yellow('  HOLD mode — the test value is LEFT IN PLACE for visual checking.'),
      );
      console.log('  Restore it when you are done:');
      console.log(
        c.dim(
          '    METABASE_API_KEY=... node scripts/metabase-appearance-probe.mjs --restore',
        ),
      );
      console.log(c.dim(`  Saved original: ${backupPath}`));
    } else {
      await restore();
    }
  }
}

main().catch(async (err) => {
  console.error();
  console.error(c.red('FAILED: ' + err.message));
  process.exitCode = 1;
});
