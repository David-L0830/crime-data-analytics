import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The incident form's location section, after the map picker replaced the two
 * coordinate boxes (Checkpoint 3).
 *
 * SOURCE-LEVEL, for the same reason every other guard in this directory is:
 * Vitest runs in a Node environment with no jsdom (see vitest.config.js), and
 * the modal now imports Leaflet transitively, which touches `window` at module
 * scope — importing it here would fail to load, not merely fail to render.
 *
 * So this suite proves what the code says: that no typed coordinate field
 * survives, that the picker is wired to the form's own state, and that clearing
 * empties both halves. It proves NOTHING about Leaflet's behaviour in a modal.
 * That needs a browser and is reported separately.
 */

const here = dirname(fileURLToPath(import.meta.url));
const modal = readFileSync(join(here, 'IncidentModal.jsx'), 'utf8');

/** The modal with comments removed, so assertions are about code. */
const code = modal
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/** The shared form body, where the location section lives. */
const fields = (() => {
  const start = code.indexOf('function IncidentFormFields(');
  expect(start).toBeGreaterThan(-1);
  const next = code.indexOf('\nexport function ', start);
  return code.slice(start, next === -1 ? code.length : next);
})();

describe('the incident form no longer accepts a typed coordinate', () => {
  it('has no latitude or longitude input', () => {
    expect(code).not.toContain('-latitude`}');
    expect(code).not.toContain('-longitude`}');
    expect(code).not.toContain("set('latitude')");
    expect(code).not.toContain("set('longitude')");
    // The two number boxes this replaced.
    expect(code).not.toMatch(/<input[^>]*type="number"[^>]*step="any"/);
  });

  it('shows both coordinates read-only instead', () => {
    expect(fields).toContain('coordinateDisplay(form.latitude)');
    expect(fields).toContain('coordinateDisplay(form.longitude)');
    expect(fields).toContain('incident-location-readout');
  });

  it('formats through the shared helper rather than its own rounding', () => {
    expect(code).toContain("import { formatCoordinate } from './locationPickerState'");
    expect(code).toContain('return formatCoordinate(value) || String(value);');
    // No second precision rule anywhere in the modal.
    expect(code).not.toContain('toFixed(');
  });

  it('shows a malformed stored value as stored, not as "Not set"', () => {
    // Hiding one behind an empty-looking placeholder would misrepresent the
    // record, and the form is not allowed to correct it either.
    expect(code).toContain("if (isBlankCoordinate(value)) return 'Not set';");
  });
});

describe('the picker is wired to the form state, once', () => {
  it('renders LocationPicker from the form values', () => {
    expect(code).toContain("import LocationPicker from './LocationPicker'");
    expect(fields).toContain('latitude={form.latitude}');
    expect(fields).toContain('longitude={form.longitude}');
  });

  it('lives in the shared field body, so create and edit get the same one', () => {
    expect(code.match(/<LocationPicker/g)).toHaveLength(1);
    for (const owner of ['IncidentCreateModal', 'IncidentEditModal']) {
      expect(code).toContain(`export function ${owner}(`);
    }
    expect(code).toContain('<IncidentFormFields');
  });

  it('writes back through the form’s own setter, with no second state', () => {
    expect(fields).toContain("setValue('latitude', latitude)");
    expect(fields).toContain("setValue('longitude', longitude)");
    // No parallel coordinate state that could disagree with the form.
    expect(fields).not.toMatch(/useState\([^)]*latitude/i);
    expect(fields).not.toContain('pinStateFor');
  });
});

describe('clearing a location empties both halves', () => {
  it('sets latitude and longitude together', () => {
    const clearAt = fields.indexOf('Clear location');
    expect(clearAt).toBeGreaterThan(-1);
    const control = fields.slice(clearAt - 700, clearAt);
    expect(control).toContain("setValue('latitude', '')");
    expect(control).toContain("setValue('longitude', '')");
    // A half-pair is what the server's required_with rule rejects.
    expect(control).not.toMatch(/setValue\('latitude', ''\)[^}]*\}\s*\}\s*>/);
  });

  it('offers the control only when there is something to clear', () => {
    expect(fields).toContain('isBlankCoordinate(form.latitude)');
    expect(fields).toContain('isBlankCoordinate(form.longitude)');
  });

  it('belongs to the form, not to the picker', () => {
    const picker = readFileSync(join(here, 'LocationPicker.jsx'), 'utf8');
    expect(picker).not.toContain('Clear location');
  });
});

describe('the submission contract is unchanged', () => {
  it('still builds the pair with coordinatePayload in both modals', () => {
    expect(code.match(/\.\.\.coordinatePayload\(form\)/g)).toHaveLength(2);
    expect(code).toContain("} from './incidentSubmission';");
  });

  it('adds no fallback, rounding or correction on the way out', () => {
    expect(code).not.toMatch(/\bsnap|\bclamp|nearestPoint/i);
    expect(code).not.toContain('latitude: form.latitude ?');
    expect(code).not.toContain('incident.latitude ||');
  });
});

describe('sitio and street are untouched', () => {
  it('keeps the required Sitio select and the free-text Street field', () => {
    expect(fields).toContain('Sitio *');
    expect(fields).toContain("value={form.sitio}");
    expect(fields).toContain("onChange={set('sitio')}");
    expect(fields).toContain('Location / Street');
    expect(fields).toContain("onChange={set('street')}");
  });

  it('derives neither of them from the coordinates', () => {
    // No reverse geocoding, no automatic sitio, no street lookup.
    expect(code).not.toMatch(/geocod|nominatim/i);
    expect(fields).not.toMatch(/setValue\('sitio'/);
    expect(fields).not.toMatch(/setValue\('street'/);
  });
});

describe('the location section is reachable without the map', () => {
  it('names and describes the map region for a screen reader', () => {
    expect(fields).toContain('role="group"');
    expect(fields).toContain('aria-labelledby={`${uid}-location`}');
    expect(fields).toContain('aria-describedby={`${uid}-location-hint`}');
  });

  it('announces the selected coordinates in one live region', () => {
    // Somebody who cannot see the pin move still has to be told what it moved
    // to; one region so a single move is announced once, not twice.
    expect(fields.match(/incident-location-readout" role="status"/g)).toHaveLength(1);
  });

  it('uses a real button for Clear, so it is keyboard reachable', () => {
    const clearAt = fields.indexOf('Clear location');
    expect(fields.slice(clearAt - 700, clearAt)).toContain('type="button"');
  });

  it('states the location is optional rather than leaving it to be guessed', () => {
    expect(fields).toMatch(/Optional\s*—\s*leave it unset/);
  });
});
