import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATUSES, ASSIGNABLE_STATUSES } from '../../utils/constants';

/**
 * 'Archived' is a status the app DISPLAYS and FILTERS BY, but not one anybody
 * may assign from the incident form.
 *
 * Archiving is a two-column write: previous_status has to capture the status
 * being left at the same moment status becomes 'Archived'. Only
 * PUT /api/incidents/{id}/archive does that, and only it refuses a second
 * archive and writes the ARCHIVE audit event. While the create/edit form
 * offered 'Archived' in its Status dropdown, an ordinary save could reach the
 * archived state with previous_status still null — so Restore had nothing to
 * read and could only fall back to 'Open' — and it logged as UPDATE.
 *
 * The server is the enforcing side (Store/UpdateIncidentRequest validate
 * against Incident::ASSIGNABLE_STATUSES; see StatusValidationTest and
 * IncidentTest). Removing it from the dropdown is what stops a 422 being the
 * first anyone hears of it.
 *
 * WHAT THIS TEST DOES AND DOES NOT PROVE
 * --------------------------------------
 * The first group is behavioural — it imports the real constants. The rest are
 * SOURCE-LEVEL guards, the same approach as incidentModalFocus.test.js and for
 * the same reason: the Vitest suite runs in a Node environment with no DOM
 * (vitest.config.js), so a rendered <select> cannot be inspected here. What
 * they pin is the exact wiring that was wrong.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(here, ...parts), 'utf8');

const incidentModalSource = read('IncidentModal.jsx');
const incidentFeedSource = read('..', '..', 'pages', 'IncidentFeed.jsx');
const incidentModelSource = read(
  '..',
  '..',
  '..',
  'backend',
  'app',
  'Models',
  'Incident.php',
);

// Pulls the values out of a PHP `public const NAME = ['a', 'b'];` block so the
// two sides of the contract can be compared rather than restated.
function phpConst(source, name) {
  const block = new RegExp(`public const ${name} = \\[([^\\]]*)\\];`).exec(
    source,
  );
  expect(block, `Incident::${name} not found`).not.toBeNull();
  return [...block[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

describe('incident status vocabulary', () => {
  it('keeps Archived in the global vocabulary used for filtering and display', () => {
    expect(STATUSES).toContain('Archived');
  });

  it('excludes Archived from the statuses a form may assign', () => {
    expect(ASSIGNABLE_STATUSES).not.toContain('Archived');
  });

  it('differs from the global vocabulary by Archived alone', () => {
    // Guards against over-tightening as well as drift: every other status
    // stays assignable.
    expect(ASSIGNABLE_STATUSES).toEqual(
      STATUSES.filter((s) => s !== 'Archived'),
    );
  });

  it('agrees with the server-side constants in Incident.php', () => {
    // The React constants mirror the PHP ones by hand. If one side gains a
    // status and the other does not, the form and the validator disagree and
    // the user meets a 422 for a value the dropdown offered.
    expect(STATUSES).toEqual(phpConst(incidentModelSource, 'STATUSES'));
    expect(ASSIGNABLE_STATUSES).toEqual(
      phpConst(incidentModelSource, 'ASSIGNABLE_STATUSES'),
    );
  });
});

describe('IncidentFeed wires the two vocabularies to the right places', () => {
  it('gives both the create and the edit modal the assignable set', () => {
    const passes = incidentFeedSource.match(/statuses=\{[A-Z_]+\}/g) || [];

    expect(passes).toHaveLength(2); // IncidentEditModal + IncidentCreateModal
    expect(passes).toEqual([
      'statuses={ASSIGNABLE_STATUSES}',
      'statuses={ASSIGNABLE_STATUSES}',
    ]);
  });

  it('still offers the full vocabulary in the Status filter', () => {
    // The regression this guards is the opposite mistake: narrowing the filter
    // too would make archived incidents unreachable in the UI, since the feed
    // hides them unless 'Archived' is explicitly selected.
    expect(incidentFeedSource).toMatch(
      /id: 'inc-status',\s*label: 'Status',\s*type: 'select',\s*options: STATUSES,/,
    );
  });
});

describe('editing an incident that is already archived', () => {
  it('never sends a status for it', () => {
    // An archived incident can still be opened in the edit form (View ->
    // Edit), and its details must stay correctable. Because 'Archived' is no
    // longer among the options, leaving the payload alone would have sent
    // either 'Archived' (a 422) or the blank first option. The key is dropped
    // instead: IncidentController::mapToColumns() copies only keys that are
    // present, so the column is untouched.
    expect(incidentModalSource).toMatch(
      /if \(incident\?\.status === 'Archived'\) \{\s*delete data\.status;\s*\}/,
    );
  });

  it('locks the Status control rather than showing a value it cannot offer', () => {
    expect(incidentModalSource).toContain(
      "statusLocked={shown.status === 'Archived'}",
    );
    expect(incidentModalSource).toContain('disabled={statusLocked}');
  });

  it('does not lock the create form, which has no current status to keep', () => {
    // statusLocked is passed to exactly one of the two IncidentFormFields
    // call sites - the edit modal's.
    const locks = incidentModalSource.match(/statusLocked=\{/g) || [];
    expect(locks).toHaveLength(1);
  });
});
