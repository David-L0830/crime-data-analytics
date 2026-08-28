#!/usr/bin/env node
/**
 * Makes embedded Metabase chart cards transparent, so they inherit the app's
 * own dark card colour (--bg-card, #1b221a) instead of painting Metabase's
 * navy surface on top of it.
 *
 * WHY A SCRIPT AND NOT A CLICK IN METABASE
 * ----------------------------------------
 * The renderer in Metabase v0.63.14 honours a per-dashcard setting:
 *
 *     X = !S && (false === dashcard.visualization_settings["dashcard.background"]
 *                || isActionDashcard(dashcard))
 *
 * which applies `.nTmk6 { border:0 !important; background:transparent !important }`.
 * That check is NOT gated on the card's display type, so it works for charts.
 *
 * But the *editing UI* for it is registered only on the Text card
 * (identifier:"text"). Heading cards get the key with a default and no widget;
 * chart cards do not register it at all. There is exactly one "Show background"
 * string in the whole application bundle and it belongs to Text. So there is no
 * click path for a chart card, and the supported route is the Dashboard API.
 *
 * WHAT IT TOUCHES
 * ---------------
 * Exactly one key, `"dashcard.background": false`, merged into each chart
 * dashcard's existing visualization_settings. Everything else on the dashcard
 * is echoed back byte-for-byte: row, col, size_x, size_y, series,
 * parameter_mappings, dashboard_tab_id, entity_id and any other field the
 * server sent.
 *
 * It deliberately does NOT send back the embedded `card` object (the saved
 * question). That object is what holds chart type, colours, axes and field
 * settings; dropping it from the payload means this script cannot alter a
 * saved question even by accident. The dashcard still references it by card_id.
 *
 * SAFETY
 * ------
 *   - dry run by default; a PUT happens only with --apply
 *   - every dashboard is backed up to JSON before any write, and --apply
 *     aborts if a backup cannot be written
 *   - idempotent: a dashcard already set to false is skipped
 *   - aborts if the dashcard count changes between read and write
 *   - credentials come from the environment only, are never logged, and are
 *     never written to any file
 *
 * USAGE
 *   METABASE_API_KEY=... node scripts/metabase-dashcard-background.mjs
 *   METABASE_API_KEY=... node scripts/metabase-dashcard-background.mjs --apply
 *
 * ENVIRONMENT
 *   METABASE_API_KEY                  preferred; sent as the x-api-key header
 *   METABASE_USER / METABASE_PASSWORD fallback; POST /api/session
 *   METABASE_URL                      default http://localhost:3000
 *
 * FLAGS
 *   --apply              perform the PUT (otherwise nothing is written)
 *   --restore            REVERSE the change: delete the "dashcard.background"
 *                        key so Metabase's default (true) applies again and the
 *                        native per-card border returns. The key is deleted
 *                        rather than set to true because these dashcards had
 *                        completely empty visualization_settings originally —
 *                        deleting restores that exact shape, writing `true`
 *                        would leave a key that was never there.
 *   --dashboards=2,3,4   override the dashboard ids (default 2,3,4)
 *   --backup-dir=PATH    override the backup directory
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const BASE_URL = (process.env.METABASE_URL || 'http://localhost:3000').replace(
  /\/+$/,
  '',
);

const SETTING_KEY = 'dashcard.background';

// Virtual cards render their own way and are not what this script is for. Text
// is also the one card type where the UI toggle genuinely exists, so a human
// can set it there without help.
const VIRTUAL_DISPLAYS = new Set(['text', 'heading', 'link', 'action']);

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);

function flag(name) {
  return args.includes(`--${name}`);
}

function option(name, fallback) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const APPLY = flag('apply');
const RESTORE = flag('restore');
const DASHBOARD_IDS = option('dashboards', '2,3,4')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);
const BACKUP_DIR = resolve(HERE, option('backup-dir', 'backups'));

if (DASHBOARD_IDS.length === 0) {
  console.error('No valid dashboard ids. Example: --dashboards=2,3,4');
  process.exit(1);
}

// ------------------------------------------------------------------- output

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

function rule(char = '-') {
  console.log(char.repeat(78));
}

// --------------------------------------------------------------------- auth

// Returns the headers to authenticate with, without ever echoing the secret.
async function authHeaders() {
  const apiKey = process.env.METABASE_API_KEY;
  if (apiKey) {
    console.log(c.dim('  auth: API key (x-api-key header)'));
    return { 'x-api-key': apiKey };
  }

  const user = process.env.METABASE_USER;
  const password = process.env.METABASE_PASSWORD;
  if (user && password) {
    console.log(c.dim(`  auth: session for ${user} (POST /api/session)`));
    const res = await fetch(`${BASE_URL}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password }),
    });
    if (!res.ok) {
      throw new Error(
        `POST /api/session failed: ${res.status} ${await res.text()}`,
      );
    }
    const { id } = await res.json();
    if (!id) throw new Error('POST /api/session returned no session id');
    return { 'X-Metabase-Session': id };
  }

  throw new Error(
    'No credentials. Set METABASE_API_KEY, or METABASE_USER and METABASE_PASSWORD.\n' +
      'Create a key at: ' +
      `${BASE_URL}/admin/settings/authentication/api-keys`,
  );
}

// ---------------------------------------------------------------- api calls

async function getDashboard(id, headers) {
  const res = await fetch(`${BASE_URL}/api/dashboard/${id}`, { headers });
  if (!res.ok) {
    throw new Error(
      `GET /api/dashboard/${id} failed: ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}

async function putDashcards(id, dashcards, headers) {
  const res = await fetch(`${BASE_URL}/api/dashboard/${id}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dashcards }),
  });
  if (!res.ok) {
    throw new Error(
      `PUT /api/dashboard/${id} failed: ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}

// ----------------------------------------------------------------- dashcard

function isChartDashcard(dc) {
  // A real saved question, not a virtual card.
  if (dc.card_id === null || dc.card_id === undefined) return false;
  if (dc.action_id) return false;
  if (dc.visualization_settings?.virtual_card) return false;

  const display = dc.card?.display;
  if (!display) return false;
  return !VIRTUAL_DISPLAYS.has(display);
}

// Echo the dashcard back with the one key set, or removed under --restore.
//
// `card` is stripped deliberately: it is the saved question, and leaving it out
// of the payload makes it impossible for this script to alter chart type,
// colours, axes or field settings. The dashcard keeps its card_id reference.
function transformed(dc) {
  const { card: _card, ...rest } = dc;
  const settings = { ...(dc.visualization_settings ?? {}) };

  if (RESTORE) {
    delete settings[SETTING_KEY];
  } else {
    settings[SETTING_KEY] = false;
  }

  return { ...rest, visualization_settings: settings };
}

// Whether this dashcard still needs the change, so a re-run is a no-op.
function needsChange(dc) {
  const present = SETTING_KEY in (dc.visualization_settings ?? {});
  return RESTORE ? present : dc.visualization_settings?.[SETTING_KEY] !== false;
}

function settingKeys(dc) {
  const keys = Object.keys(dc.visualization_settings ?? {});
  return keys.length ? keys.sort().join(', ') : '(none)';
}

// --------------------------------------------------------------------- main

async function main() {
  console.log();
  console.log(c.bold('Metabase dashcard background'));
  console.log(`  target    : ${BASE_URL}`);
  console.log(`  dashboards: ${DASHBOARD_IDS.join(', ')}`);
  console.log(
    `  action    : ${RESTORE ? c.cyan('RESTORE — remove the key, native borders return') : c.cyan('SET — transparent card backgrounds')}`,
  );
  console.log(
    `  mode      : ${APPLY ? c.yellow('APPLY (will PUT)') : c.green('DRY RUN (no writes)')}`,
  );

  const headers = await authHeaders();
  await mkdir(BACKUP_DIR, { recursive: true });
  console.log(`  backups   : ${BACKUP_DIR}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const plans = [];
  let totalChanging = 0;
  let totalSkipped = 0;
  let totalVirtual = 0;

  for (const id of DASHBOARD_IDS) {
    console.log();
    rule('=');
    const dash = await getDashboard(id, headers);
    const dashcards = dash.dashcards ?? [];
    console.log(
      c.bold(`Dashboard ${id}: ${dash.name}`) +
        c.dim(`  (${dashcards.length} dashcards)`),
    );

    // Backup before anything else, so --apply always has a restore point.
    const backupPath = resolve(BACKUP_DIR, `dashboard-${id}-${stamp}.json`);
    await writeFile(backupPath, JSON.stringify(dash, null, 2), 'utf8');
    console.log(c.dim(`  backup -> ${backupPath}`));

    const changing = [];

    for (const dc of dashcards) {
      const name = dc.card?.name ?? dc.visualization_settings?.text ?? '—';
      const display = dc.card?.display ?? '(virtual)';

      if (!isChartDashcard(dc)) {
        totalVirtual++;
        console.log(
          c.dim(
            `  skip  dashcard ${String(dc.id).padEnd(5)} ${display.padEnd(12)} not a chart card`,
          ),
        );
        continue;
      }

      if (!needsChange(dc)) {
        totalSkipped++;
        console.log(
          c.dim(
            `  skip  dashcard ${String(dc.id).padEnd(5)} ${display.padEnd(12)} ` +
              (RESTORE ? 'key already absent' : 'already false'),
          ),
        );
        continue;
      }

      if (Array.isArray(dc.series) && dc.series.length > 0) {
        console.log(
          c.yellow(
            `  note  dashcard ${dc.id} has ${dc.series.length} extra series; its series array is echoed back unchanged`,
          ),
        );
      }

      const next = transformed(dc);
      changing.push({ before: dc, after: next });
      totalChanging++;

      console.log();
      console.log(
        c.cyan(`  CHANGE dashcard ${dc.id}`) +
          `  ${c.bold(name)}  ${c.dim(`[${display}]`)}`,
      );
      console.log(`    before: ${settingKeys(dc)}`);
      console.log(`    after : ${settingKeys(next)}`);
      console.log(
        c.dim(
          `    only "${SETTING_KEY}" is added; ${Object.keys(dc.visualization_settings ?? {}).length} existing key(s) preserved`,
        ),
      );
    }

    plans.push({ id, name: dash.name, dashcards, changing, backupPath });
  }

  console.log();
  rule('=');
  console.log(c.bold('Summary'));
  console.log(`  dashcards to change : ${totalChanging}`);
  console.log(`  already correct     : ${totalSkipped}`);
  console.log(`  non-chart, skipped  : ${totalVirtual}`);

  if (totalChanging === 0) {
    console.log();
    console.log(c.green('Nothing to do — every chart dashcard is already set.'));
    return;
  }

  if (!APPLY) {
    console.log();
    console.log(c.green('DRY RUN — nothing was written to Metabase.'));
    console.log('Re-run with --apply to perform the update:');
    console.log(
      c.dim(
        `  METABASE_API_KEY=... node scripts/metabase-dashcard-background.mjs${RESTORE ? ' --restore' : ''} --apply`,
      ),
    );
    return;
  }

  console.log();
  console.log(c.yellow('APPLYING…'));

  for (const plan of plans) {
    if (plan.changing.length === 0) {
      console.log(c.dim(`  dashboard ${plan.id}: nothing to change`));
      continue;
    }

    const changedIds = new Set(plan.changing.map((x) => x.before.id));
    const payload = plan.dashcards.map((dc) => {
      const { card: _card, ...rest } = dc;
      return changedIds.has(dc.id) ? transformed(dc) : rest;
    });

    // A mismatch here would mean the dashboard changed under us.
    if (payload.length !== plan.dashcards.length) {
      throw new Error(
        `dashboard ${plan.id}: payload length ${payload.length} != ${plan.dashcards.length}; aborting`,
      );
    }

    await putDashcards(plan.id, payload, headers);
    console.log(
      c.green(
        `  dashboard ${plan.id}: updated ${plan.changing.length} dashcard(s)`,
      ),
    );

    // Read back and confirm the setting actually landed.
    const after = await getDashboard(plan.id, headers);
    const stillWrong = (after.dashcards ?? []).filter(
      (dc) => isChartDashcard(dc) && needsChange(dc),
    );
    if (stillWrong.length > 0) {
      console.log(
        c.red(
          `  WARNING dashboard ${plan.id}: ${stillWrong.length} chart dashcard(s) did not take the change`,
        ),
      );
    } else {
      console.log(
        c.dim(
          `  verified: all chart dashcards are now ${RESTORE ? 'back to the Metabase default (bordered)' : 'transparent'}`,
        ),
      );
    }
  }

  console.log();
  console.log(c.green('Done. Hard-reload the app (Ctrl+Shift+R) to see it.'));
  console.log(
    c.dim('Backups are in ' + BACKUP_DIR + '; Metabase also keeps revisions.'),
  );
}

main().catch((err) => {
  console.error();
  console.error(c.red('FAILED: ' + err.message));
  process.exit(1);
});
