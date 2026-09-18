import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  coordinatePayload,
  submissionErrorMessages,
} from './incidentSubmission';

/**
 * Two defects in one area of the incident form.
 *
 * R2 — the edit modal fell back to the STORED coordinate whenever the field
 * was blank, so a coordinate could never be cleared: the encoder emptied both
 * boxes, saved, and the old values were quietly written back.
 *
 * R3 — a 422 from the API was reported only as a toast. `err.errors`, which is
 * the half that names the offending field, was discarded.
 *
 * The payload and error-mapping halves are pure functions and are tested as
 * such. The "modal stays open, values preserved" half is a SOURCE-LEVEL guard,
 * matching this suite's existing approach (see incidentModalFocus.test.js):
 * Vitest runs in a Node environment with no DOM, so a mount is not available
 * here.
 */

const here = dirname(fileURLToPath(import.meta.url));
const modalSource = readFileSync(join(here, 'IncidentModal.jsx'), 'utf8');
const feedSource = readFileSync(
  join(here, '..', '..', 'pages', 'IncidentFeed.jsx'),
  'utf8',
);

/** Body of one exported component, up to the next top-level export. */
function componentBody(name) {
  const start = modalSource.indexOf('export function ' + name + '(');
  expect(start, name + ' not found').toBeGreaterThan(-1);
  const next = modalSource.indexOf('\nexport function ', start + 1);
  return modalSource.slice(start, next === -1 ? modalSource.length : next);
}

/** Body of one handler in IncidentFeed, up to its closing `};`. */
function handlerBody(name) {
  const start = feedSource.indexOf('const ' + name + ' = async');
  expect(start, name + ' not found').toBeGreaterThan(-1);
  return feedSource.slice(start, feedSource.indexOf('};', start));
}

/** The submit path of a modal, excluding its JSX. */
function submitPath(body) {
  return body.slice(body.indexOf('const handleSubmit'), body.indexOf('return ('));
}

// ===== R2 — coordinates can be cleared =====

describe('coordinatePayload', () => {
  it('sends null for both when the encoder clears both fields', () => {
    expect(coordinatePayload({ latitude: '', longitude: '' })).toEqual({
      latitude: null,
      longitude: null,
    });
  });

  it('preserves coordinates the encoder did not touch', () => {
    // The edit form opens pre-filled from the record, so "untouched" means the
    // stored values are still sitting in the form fields.
    expect(
      coordinatePayload({ latitude: '14.7554', longitude: '121.0327' }),
    ).toEqual({ latitude: 14.7554, longitude: 121.0327 });

    // Pre-fill can hand numbers straight through rather than strings.
    expect(
      coordinatePayload({ latitude: 14.7554, longitude: 121.0327 }),
    ).toEqual({ latitude: 14.7554, longitude: 121.0327 });
  });

  it('does not retain the other half when only one field is cleared', () => {
    // Sent as a half-pair on purpose: the backend's `required_with` rule
    // rejects it. Nothing is guessed, restored or completed here.
    expect(coordinatePayload({ latitude: '', longitude: '121.0327' })).toEqual({
      latitude: null,
      longitude: 121.0327,
    });
    expect(coordinatePayload({ latitude: '14.7554', longitude: '' })).toEqual({
      latitude: 14.7554,
      longitude: null,
    });
  });

  it('treats whitespace and absent values as cleared, but 0 as a value', () => {
    expect(
      coordinatePayload({ latitude: '   ', longitude: undefined }),
    ).toEqual({ latitude: null, longitude: null });
    expect(coordinatePayload({ latitude: 0, longitude: '0' })).toEqual({
      latitude: 0,
      longitude: 0,
    });
  });
});

describe('the edit modal no longer falls back to the stored coordinate', () => {
  const body = componentBody('IncidentEditModal');

  it('does not read incident.latitude / incident.longitude when building the payload', () => {
    // Scoped to the submit path: the effect that pre-fills the form from the
    // record legitimately reads both, and must keep doing so.
    const submit = submitPath(body);
    expect(submit).not.toMatch(/latitude:\s*form\.latitude\s*\?/);
    expect(submit).not.toContain('incident.latitude');
    expect(submit).not.toContain('incident.longitude');
  });

  it('builds the pair through the shared helper', () => {
    expect(body).toContain('...coordinatePayload(form)');
  });
});

it('the create modal builds its coordinate pair the same way', () => {
  expect(componentBody('IncidentCreateModal')).toContain(
    '...coordinatePayload(form)',
  );
});

// ===== R3 — backend validation errors reach the form =====

describe('submissionErrorMessages', () => {
  it('shows every field-level message from a 422 errors bag', () => {
    const err = {
      status: 422,
      message: 'Please check the form for errors.',
      errors: {
        date: ['Incident date cannot be in the future.'],
        latitude: ['That location is outside Barangay 178.'],
      },
    };

    expect(submissionErrorMessages(err, 'Could not save incident.')).toEqual([
      'Incident date cannot be in the future.',
      'That location is outside Barangay 178.',
    ]);
  });

  it('keeps several messages for the same field', () => {
    const err = {
      status: 422,
      errors: { caseNumber: ['Case number already exists.', 'Too long.'] },
    };

    expect(submissionErrorMessages(err, 'fallback')).toEqual([
      'Case number already exists.',
      'Too long.',
    ]);
  });

  it('deduplicates, because the modal keys its list items by message text', () => {
    const err = {
      errors: { latitude: ['Same message.'], longitude: ['Same message.'] },
    };

    expect(submissionErrorMessages(err, 'fallback')).toEqual(['Same message.']);
  });

  it('falls back to err.message when a 422 carries no errors bag', () => {
    expect(
      submissionErrorMessages(
        { status: 422, message: 'Please check the form for errors.' },
        'Could not save incident.',
      ),
    ).toEqual(['Please check the form for errors.']);
  });

  it('falls back to the supplied message when there is nothing else at all', () => {
    expect(
      submissionErrorMessages(new Error(''), 'Could not save incident.'),
    ).toEqual(['Could not save incident.']);
    expect(
      submissionErrorMessages(undefined, 'Could not save incident.'),
    ).toEqual(['Could not save incident.']);
  });

  it('is not fooled by a non-object errors value', () => {
    expect(
      submissionErrorMessages({ message: 'Boom', errors: 'nope' }, 'fallback'),
    ).toEqual(['Boom']);
  });
});

describe.each([
  ['IncidentCreateModal', 'Could not save incident.'],
  ['IncidentEditModal', 'Could not update incident.'],
])('%s renders a rejected save in the form', (name, fallback) => {
  const body = componentBody(name);

  it('catches the failed onSave and puts the messages in the error area', () => {
    expect(submitPath(body)).toContain(
      "setErrors(submissionErrorMessages(err, '" + fallback + "'))",
    );
    // The same area the client-side messages already use.
    expect(body).toContain('<div className="form-errors">');
  });

  it('does not close itself on a failed save', () => {
    // Only Cancel and the Modal's own dismissal close it; nothing in the
    // submit path calls onClose.
    expect(submitPath(body)).not.toContain('onClose');
  });

  it('leaves the entered values alone so nothing has to be retyped', () => {
    expect(submitPath(body)).not.toContain('setForm(');
  });
});

describe('IncidentFeed hands the error to the modal', () => {
  it('re-throws from both save handlers instead of swallowing the error', () => {
    for (const handler of ['handleSave', 'handleCreate']) {
      expect(handlerBody(handler)).toMatch(/catch \(err\) \{[\s\S]*throw err;/);
    }
  });

  it('only clears the open modal on the success path', () => {
    // setEditing(null) / setCreating(false) must sit before the catch, so a
    // rejected save cannot close the form the messages are being shown in.
    for (const [handler, close] of [
      ['handleSave', 'setEditing(null)'],
      ['handleCreate', 'setCreating(false)'],
    ]) {
      const body = handlerBody(handler);
      expect(body.indexOf(close)).toBeGreaterThan(-1);
      expect(body.indexOf(close)).toBeLessThan(body.indexOf('} catch (err) {'));
    }
  });
});
