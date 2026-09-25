import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeReturnReason } from './returnReason';
import { CORRECTION_REASONS } from '../../utils/constants';

/**
 * Checkpoint 2 — predefined Return-for-Correction reasons.
 *
 * The backend endpoint (PUT /incidents/{id}/return) has always taken, and
 * still takes, one free-text `reason` string of 5-1000 characters. Nothing on
 * that contract changes here: ValidationPanel (in IncidentModal.jsx) lets a
 * validator pick from CORRECTION_REASONS and/or type custom text, and
 * composeReturnReason() turns that selection into the single string the
 * unchanged endpoint receives.
 *
 * composeReturnReason() LIVES IN ITS OWN FILE, separate from
 * IncidentModal.jsx, so it can be imported here and tested with real inputs.
 * IncidentModal.jsx imports LocationPicker, which imports Leaflet, and
 * Leaflet touches `window` at module load time — importing anything from
 * IncidentModal.jsx in this Vitest suite (a Node environment with no DOM; see
 * vitest.config.js) crashes before a single assertion runs. This is the same
 * reason incidentSubmission.js and locationPickerState.js exist as their own
 * files rather than living inside IncidentModal.jsx / LocationPicker.jsx.
 *
 * The surrounding UI wiring in ValidationPanel — the checkbox list, the
 * optional custom-text field, the two guards on submit — is a SOURCE-LEVEL
 * guard below, matching this suite's existing approach elsewhere in this
 * directory (see incidentModalFocus.test.js, incidentSubmission.test.js): a
 * checkbox cannot actually be clicked in this environment, but reading
 * IncidentModal.jsx as text does not import it, so it is safe here.
 */

const here = dirname(fileURLToPath(import.meta.url));
const modalSource = readFileSync(join(here, 'IncidentModal.jsx'), 'utf8');
const controllerSource = readFileSync(
  join(
    here,
    '..',
    '..',
    '..',
    'backend',
    'app',
    'Http',
    'Controllers',
    'Api',
    'IncidentController.php',
  ),
  'utf8',
);

describe('CORRECTION_REASONS vocabulary', () => {
  it('is a non-empty list of { code, label } pairs', () => {
    expect(Array.isArray(CORRECTION_REASONS)).toBe(true);
    expect(CORRECTION_REASONS.length).toBe(10);
    for (const r of CORRECTION_REASONS) {
      expect(typeof r.code).toBe('string');
      expect(r.code.length).toBeGreaterThan(0);
      expect(typeof r.label).toBe('string');
      expect(r.label.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate codes', () => {
    const codes = CORRECTION_REASONS.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('includes an "Other" option, for when no predefined reason fits', () => {
    expect(CORRECTION_REASONS.some((r) => r.label === 'Other')).toBe(true);
  });
});

describe('composeReturnReason — the string the unchanged endpoint receives', () => {
  it('returns an empty string when nothing is selected or typed', () => {
    expect(composeReturnReason([], '')).toBe('');
  });

  it("returns a single selected reason's label as-is", () => {
    expect(composeReturnReason(['incorrect_location'], '')).toBe(
      'Incorrect incident location',
    );
  });

  it('joins multiple selected reasons with "; ", in vocabulary order (ordering)', () => {
    // Passed in the opposite order from how CORRECTION_REASONS lists them —
    // the output must not depend on click order, only on the vocabulary's
    // own order, so the same set of reasons always composes to the same
    // string regardless of the sequence a validator clicked them in.
    const composed = composeReturnReason(
      ['incorrect_classification', 'missing_information'],
      '',
    );
    expect(composed).toBe(
      'Missing required information; Incorrect crime classification',
    );
  });

  it('ignores a code that is not in the vocabulary rather than inserting it', () => {
    expect(composeReturnReason(['not-a-real-code'], '')).toBe('');
  });

  it('does not duplicate a label when the same code is selected twice (deduplication)', () => {
    expect(
      composeReturnReason(['incorrect_location', 'incorrect_location'], ''),
    ).toBe('Incorrect incident location');
  });

  it('returns trimmed custom text alone when no reason is selected (trimming)', () => {
    expect(
      composeReturnReason([], '  Sitio pin is on the wrong street.  '),
    ).toBe('Sitio pin is on the wrong street.');
  });

  it('treats whitespace-only custom text as no custom text (trimming)', () => {
    expect(composeReturnReason(['incorrect_location'], '   ')).toBe(
      'Incorrect incident location',
    );
  });

  it('appends trimmed custom text under a "Details:" line when both are given ("Details:" composition)', () => {
    expect(
      composeReturnReason(
        ['incorrect_location', 'incorrect_classification'],
        '  Pin is on Kalayaan St., not Rizal St.  ',
      ),
    ).toBe(
      'Incorrect incident location; Incorrect crime classification\n' +
        'Details: Pin is on Kalayaan St., not Rizal St.',
    );
  });
});

describe('ValidationPanel renders the predefined reasons and stays within the existing contract', () => {
  // ValidationPanel is not exported — isolated from the whole module by its
  // own function boundary rather than IncidentModal.jsx's componentBody()
  // helper (used elsewhere in this directory), which only finds `export
  // function` declarations.
  const panelStart = modalSource.indexOf('function ValidationPanel(');
  const panelEnd = modalSource.indexOf('\nexport function ', panelStart);
  const panel = modalSource.slice(panelStart, panelEnd);

  it('imports composeReturnReason from the pure returnReason module, not defining it inline', () => {
    expect(modalSource).toMatch(
      /import \{ composeReturnReason \} from '\.\/returnReason'/,
    );
  });

  it('imports CORRECTION_REASONS from the shared constants module', () => {
    expect(modalSource).toMatch(
      /import \{\s*VALIDATION_STATUS_LABELS,\s*CORRECTION_REASONS,?\s*\} from '\.\.\/\.\.\/utils\/constants'/,
    );
  });

  it('renders one checkbox per predefined reason', () => {
    expect(panel).toMatch(/CORRECTION_REASONS\.map\(/);
    expect(panel).toMatch(/type="checkbox"/);
    expect(panel).toMatch(/checked=\{selectedReasons\.includes\(r\.code\)\}/);
  });

  it('the custom-text field is labelled optional and is not aria-required', () => {
    expect(panel).toContain('Additional details (optional)');
    expect(panel).not.toContain('aria-required="true"');
  });

  it('still calls onReturn with exactly (record, <composed string>)', () => {
    // What IncidentFeed.jsx's handleReturn(record, reason) receives, and what
    // reaches returnRecordForCorrection(record.id, reason) unchanged — see
    // validationQueue.test.js for that half of the chain.
    expect(panel).toMatch(
      /const composed = composeReturnReason\(selectedReasons, customText\)/,
    );
    expect(panel).toMatch(/await onReturn\(record, composed\)/);
  });

  it('still refuses a reason under 5 characters', () => {
    expect(panel).toMatch(/composed\.length < 5/);
  });

  it("guards the composed string against the endpoint's 1000-character limit", () => {
    expect(panel).toMatch(/composed\.length > 1000/);
  });

  it('IncidentViewModal still passes ValidationPanel the same three props', () => {
    const start = modalSource.indexOf('export function IncidentViewModal(');
    expect(start).toBeGreaterThan(-1);
    const next = modalSource.indexOf('\nexport function ', start + 1);
    const body = modalSource.slice(start, next === -1 ? modalSource.length : next);
    expect(body).toMatch(/<ValidationPanel/);
    expect(body).toMatch(/onApprove=\{onApprove\}/);
    expect(body).toMatch(/onReturn=\{onReturn\}/);
  });
});

describe('the backend endpoint is unchanged', () => {
  it('PUT /incidents/{id}/return still validates one reason string, 5-1000 characters', () => {
    const start = controllerSource.indexOf(
      'public function returnForCorrection(',
    );
    expect(start).toBeGreaterThan(-1);
    const body = controllerSource.slice(start, start + 1200);
    expect(body).toMatch(
      /'reason' => \['required', 'string', 'min:5', 'max:1000'\]/,
    );
  });

  it('the return route still requires validate_record authorization, unchanged', () => {
    expect(controllerSource).toMatch(
      /if \(! \$user\?->canValidateRecords\(\)\) \{/,
    );
  });
});
