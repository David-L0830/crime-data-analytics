import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { countBy, repeatLocationKey } from './helpers';

/**
 * F3 — repeat-location normalisation was not shared between the two pages that
 * report repeat locations.
 *
 * Dashboard's "Top Locations" table stripped the leading house number before
 * grouping, because `street` is stored house-number first ("116 Tupas St.") and
 * keying on the raw value gave every incident its own group. Trend and Pattern
 * Detection built the same `${sitio}|${street}` key from the RAW value, so from
 * one identical set of records the two pages disagreed about which locations
 * repeated at all — Dashboard saw one street with four incidents where Trends
 * saw four separate locations with one each, and neither number was labelled as
 * being computed differently from the other.
 *
 * Dashboard's expression is now repeatLocationKey() in helpers.js and both
 * pages call it. These tests pin the normalisation itself, its behaviour on the
 * empty and missing values the schema allows, and the equivalence between the
 * two pages.
 */

describe('repeatLocationKey — normalisation', () => {
  it('strips a leading house number so a street groups as one location', () => {
    expect(
      repeatLocationKey({ sitio: 'Sitio 1', street: '116 Tupas St.' }),
    ).toBe('Sitio 1|Tupas St.');
  });

  it('strips a house number with a unit letter', () => {
    expect(
      repeatLocationKey({ sitio: 'Sitio 2', street: '12B Rizal Ave' }),
    ).toBe('Sitio 2|Rizal Ave');
  });

  it('tolerates leading whitespace before the house number', () => {
    expect(
      repeatLocationKey({ sitio: 'Sitio 3', street: '  7 Mabini St.' }),
    ).toBe('Sitio 3|Mabini St.');
  });

  it('leaves a street with no leading number untouched', () => {
    expect(
      repeatLocationKey({ sitio: 'Sitio 4', street: 'Bonifacio Road' }),
    ).toBe('Sitio 4|Bonifacio Road');
  });

  it('strips only the FIRST number, keeping numbers inside the street name', () => {
    // "5 Phase 2 Street" is a house number on a numbered street, not two house
    // numbers. Only the leading token is a house number.
    expect(
      repeatLocationKey({ sitio: 'Sitio 5', street: '5 Phase 2 Street' }),
    ).toBe('Sitio 5|Phase 2 Street');
  });

  it('does not strip a number that is the whole street value', () => {
    // The pattern requires whitespace after the number, so a bare numeric
    // street is left alone rather than normalised to an empty location.
    expect(repeatLocationKey({ sitio: 'Sitio 6', street: '116' })).toBe(
      'Sitio 6|116',
    );
  });
});

describe('repeatLocationKey — edge and empty values', () => {
  // `street` is nullable in the incidents schema and 'nullable' in
  // StoreIncidentRequest, so a record with no street is legitimate data. It
  // must not reach a printed report as the string "null", which is what
  // template-interpolating the raw value produced on Trends.
  it('renders a null street as an empty location, not "null"', () => {
    expect(repeatLocationKey({ sitio: 'Sitio 7', street: null })).toBe(
      'Sitio 7|',
    );
  });

  it('renders an undefined street as an empty location', () => {
    expect(repeatLocationKey({ sitio: 'Sitio 7', street: undefined })).toBe(
      'Sitio 7|',
    );
  });

  it('renders an empty string street as an empty location', () => {
    expect(repeatLocationKey({ sitio: 'Sitio 7', street: '' })).toBe(
      'Sitio 7|',
    );
  });

  it('keeps the sitio in the key so the same street in two sitios stays apart', () => {
    const a = repeatLocationKey({ sitio: 'Sitio 1', street: '10 Tupas St.' });
    const b = repeatLocationKey({ sitio: 'Sitio 2', street: '20 Tupas St.' });
    expect(a).not.toBe(b);
  });

  it('is deterministic — the same input always yields the same key', () => {
    const record = { sitio: 'Sitio 1', street: '116 Tupas St.' };
    expect(repeatLocationKey(record)).toBe(repeatLocationKey({ ...record }));
  });
});

describe('F3 — Dashboard and Trends now agree', () => {
  // The records both pages would have counted differently: one street, four
  // different house numbers.
  const records = [
    { sitio: 'Sitio 1', street: '116 Tupas St.' },
    { sitio: 'Sitio 1', street: '118 Tupas St.' },
    { sitio: 'Sitio 1', street: '120 Tupas St.' },
    { sitio: 'Sitio 1', street: '122 Tupas St.' },
  ];

  it('groups one street with four house numbers as a single repeat location', () => {
    expect(countBy(records, repeatLocationKey)).toEqual({
      'Sitio 1|Tupas St.': 4,
    });
  });

  it('shows what the raw key used to produce, for contrast', () => {
    // The pre-fix Trends key. Four groups of one — no repeat location at all,
    // because `.filter(([, c]) => c > 1)` removed every entry.
    const raw = countBy(records, (r) => `${r.sitio}|${r.street}`);
    expect(Object.keys(raw)).toHaveLength(4);
    expect(Object.values(raw).filter((c) => c > 1)).toHaveLength(0);
  });

  it('both pages derive the key from the shared helper', () => {
    // A source-level guard: the defect was two independent expressions, so the
    // regression to prevent is either page reintroducing its own. Neither file
    // may build a sitio|street key inline again.
    const inlineKey = /`\$\{[^`]*sitio[^`]*\}\|\$\{[^`]*street/;
    for (const page of ['../pages/Dashboard.jsx', '../pages/Trends.jsx']) {
      const src = readFileSync(new URL(page, import.meta.url), 'utf8');
      expect(src).toContain('repeatLocationKey');
      expect(src).not.toMatch(inlineKey);
    }
  });
});
