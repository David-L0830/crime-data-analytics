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
    expect(code).toContain("formatCoordinate, pinStateFor, PIN_STATUS } from './locationPickerState'");
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
    //
    // pinStateFor IS read here now — the automatic street lookup below uses it
    // to gate on a point the boundary check already accepted. Reading the pair
    // is not holding it: the form remains the only place latitude and longitude
    // live, which is what this assertion is about.
    expect(fields).not.toMatch(/useState\([^)]*latitude/i);
    expect(fields).not.toMatch(/useState\([^)]*longitude/i);
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

describe('sitio and street follow the pin without being dictated by it', () => {
  it('keeps the required Sitio select and the free-text Street field', () => {
    expect(fields).toContain('Sitio *');
    expect(fields).toContain("value={form.sitio}");
    expect(fields).toContain("onChange={set('sitio')}");
    expect(fields).toContain('Location / Street');
    expect(fields).toContain("onChange={set('street')}");
  });

  it('keeps both fields editable after the pin fills them', () => {
    // The automatic lookup offers a value; it never takes the field away. A
    // disabled or readonly Sitio/Street would make the map's answer the only
    // answer, which is the opposite of what autofillPatch guarantees.
    const sitioAt = fields.indexOf('id={`${uid}-sitio`}');
    expect(fields.slice(sitioAt, sitioAt + 400)).not.toMatch(/disabled|readOnly/);
    const streetAt = fields.indexOf('id={`${uid}-street`}');
    expect(fields.slice(streetAt, streetAt + 400)).not.toMatch(/disabled|readOnly/);
  });

  it('derives them only through reverseGeocode, never inside the modal', () => {
    // The rules about what may be written — blank fields and this feature's
    // own stale values only, never the encoder's text — live in one tested
    // module. The modal applies the patch and holds no policy of its own.
    expect(code).toContain(
      "import { autofillPatch, reverseGeocode } from '../../utils/reverseGeocode';",
    );
    expect(fields).toContain('autofillPatch(');
    // No second opinion about the street, and no sitio guessed from anything.
    expect(fields).not.toMatch(/nearest|closest|fallbackSitio|guess/i);
    expect(fields).not.toContain('STREETS');
  });

  it('applies the patch rather than assigning either field directly', () => {
    // setValue is reached only through the patch autofillPatch produced, so
    // there is no path that writes a sitio or a street the module refused.
    expect(fields).toContain('Object.entries(patch).forEach(');
    expect(fields).not.toMatch(/setValue\('sitio',\s*(?!.*patch)/);
    expect(fields).not.toMatch(/setValue\('street',\s*(?!.*patch)/);
  });

  it('looks up only points the boundary check already accepted', () => {
    // An out-of-area or half-written stored coordinate is never sent to the
    // lookup, and the lookup never decides what may be saved.
    expect(fields).toContain('pinStateFor(form.latitude, form.longitude)');
    expect(fields).toContain('state.status !== PIN_STATUS.INSIDE');
  });

  it('abandons a lookup whose pin has moved on', () => {
    expect(fields).toContain('controller.abort()');
    expect(fields).toContain('clearTimeout(timer)');
    expect(fields).toContain('if (cancelled) return;');
  });

  it('re-runs on the coordinates alone, so a write cannot loop', () => {
    // Depending on `form` or on `setValue` — a new arrow each render — with a
    // setValue inside the effect is an update loop.
    expect(fields).toContain('}, [form.latitude, form.longitude]);');
  });

  it('says nothing was filled rather than leaving it ambiguous', () => {
    expect(code).toMatch(/does not name a street or an area at this point/);
    expect(code).toMatch(/could not be reached, so nothing was filled in/);
  });

  it('says when Location / Street holds a landmark or an area rather than a street', () => {
    expect(fields).toContain('lookupFilledMessage(patch, found.streetKind)');
    expect(code).toContain("place: 'the name of the landmark or building there'");
    expect(code).toContain("area: 'the area or neighbourhood'");
    expect(code).toMatch(/names no street at this point, so Location \/ Street holds \$\{NOT_A_STREET\[streetKind\]\} instead/);
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
