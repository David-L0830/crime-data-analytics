import { describe, expect, it } from 'vitest';
import { countDistinctValues, buildCrosstab } from './Analytics.jsx';
import { countBy, UNCATEGORISED } from '../utils/helpers';

/**
 * Statistical consistency of the Statistical Analysis page.
 *
 * Four defects are guarded here. Each one made a figure on the page either
 * count something that is not there, or stop counting something that is:
 *
 *  D1  "Sitios Affected" sized `new Set(filtered.map(r => r.sitio))`, so every
 *      incident saved without a sitio contributed one extra phantom sitio.
 *  D2  "Unique Locations" did the same with `r.street`.
 *  D3  The cross tabulation derived its category rows from the raw field, so a
 *      record with no category reached the table as a blank or "null" row while
 *      the Category pie chart on the same page called the same record
 *      "Uncategorised".
 *  D4  The cross tabulation's columns were the hard-coded SITIOS list, so an
 *      incident with no sitio, or with a sitio not in that list, was counted
 *      into no column at all and vanished from the table — the table did not
 *      reconcile with the Crime Frequency figure above it.
 */

const BASE_SITIOS = ['Sitio A', 'Sitio B', 'Sitio C'];

const rec = (over) => ({
  category: 'Theft',
  sitio: 'Sitio A',
  street: 'Main St',
  ...over,
});

describe('D1 — Sitios Affected', () => {
  it('does not count null, undefined or empty sitio as a sitio', () => {
    const records = [
      rec({ sitio: 'Sitio A' }),
      rec({ sitio: 'Sitio B' }),
      rec({ sitio: null }),
      rec({ sitio: undefined }),
      rec({ sitio: '' }),
    ];
    expect(countDistinctValues(records, 'sitio')).toBe(2);
  });

  it('preserves the existing valid sitio values, counted once each', () => {
    const records = [
      rec({ sitio: 'Sitio A' }),
      rec({ sitio: 'Sitio A' }),
      rec({ sitio: 'Sitio B' }),
      rec({ sitio: 'Sitio C' }),
    ];
    expect(countDistinctValues(records, 'sitio')).toBe(3);
  });

  it('is zero when no record has a sitio at all', () => {
    expect(
      countDistinctValues([rec({ sitio: null }), rec({ sitio: '' })], 'sitio'),
    ).toBe(0);
  });
});

describe('D2 — Unique Locations', () => {
  it('does not count null or empty streets as locations', () => {
    const records = [
      rec({ street: 'Main St' }),
      rec({ street: 'Side St' }),
      rec({ street: null }),
      rec({ street: '' }),
    ];
    expect(countDistinctValues(records, 'street')).toBe(2);
  });

  it('still counts each distinct recorded street once', () => {
    const records = [
      rec({ street: 'Main St' }),
      rec({ street: 'Main St' }),
      rec({ street: 'Side St' }),
    ];
    expect(countDistinctValues(records, 'street')).toBe(2);
  });
});

describe('D3 — Category consistency with the Category pie chart', () => {
  const records = [
    rec({ category: 'Theft' }),
    rec({ category: 'Assault' }),
    rec({ category: null }),
    rec({ category: undefined }),
    rec({ category: '' }),
  ];

  it('labels a missing category Uncategorised, exactly as countBy does for the pie chart', () => {
    const { rows } = buildCrosstab(records, BASE_SITIOS);
    const rowLabels = rows.map((r) => r.category).sort();
    const pieLabels = Object.keys(countBy(records, 'category')).sort();
    expect(rowLabels).toEqual(pieLabels);
    expect(rowLabels).toContain(UNCATEGORISED);
  });

  it('never emits a blank, "null" or "undefined" category row label', () => {
    const { rows } = buildCrosstab(records, BASE_SITIOS);
    rows.forEach((r) => {
      expect(r.category).not.toBe('');
      expect(r.category).not.toBe('null');
      expect(r.category).not.toBe('undefined');
    });
  });

  it('counts every missing-category incident into the one Uncategorised row', () => {
    const { rows } = buildCrosstab(records, BASE_SITIOS);
    const uncategorised = rows.find((r) => r.category === UNCATEGORISED);
    expect(uncategorised.total).toBe(3);
  });
});

describe('D4 — Cross Tabulation accounts for every filtered incident', () => {
  it('keeps the configured sitios as columns, including ones with no incidents', () => {
    const { sitioColumns } = buildCrosstab(
      [rec({ sitio: 'Sitio A' })],
      BASE_SITIOS,
    );
    expect(sitioColumns.slice(0, BASE_SITIOS.length)).toEqual(BASE_SITIOS);
  });

  it('adds a column for a sitio present in the data but absent from the configured list', () => {
    const { sitioColumns, rows } = buildCrosstab(
      [rec({ sitio: 'Sitio Z' })],
      BASE_SITIOS,
    );
    expect(sitioColumns).toContain('Sitio Z');
    expect(rows[0]['Sitio Z']).toBe(1);
  });

  it('adds an Uncategorised column for incidents with no sitio', () => {
    const { sitioColumns, rows } = buildCrosstab(
      [rec({ sitio: null }), rec({ sitio: '' })],
      BASE_SITIOS,
    );
    expect(sitioColumns).toContain(UNCATEGORISED);
    expect(rows[0][UNCATEGORISED]).toBe(2);
  });

  it('omits the Uncategorised column when every incident has a sitio', () => {
    const { sitioColumns } = buildCrosstab(
      [rec({ sitio: 'Sitio A' })],
      BASE_SITIOS,
    );
    expect(sitioColumns).not.toContain(UNCATEGORISED);
  });

  it('reconciles: the grand total equals the filtered incident total', () => {
    const records = [
      rec({ category: 'Theft', sitio: 'Sitio A' }),
      rec({ category: 'Theft', sitio: 'Sitio B' }),
      rec({ category: 'Assault', sitio: 'Sitio Z' }),
      rec({ category: null, sitio: null }),
      rec({ category: '', sitio: '' }),
      rec({ category: 'Assault', sitio: undefined }),
    ];
    const { rows } = buildCrosstab(records, BASE_SITIOS);
    const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);
    expect(grandTotal).toBe(records.length);
  });

  it('reconciles even when no incident matches any configured sitio', () => {
    const records = [
      rec({ sitio: 'Sitio Y' }),
      rec({ sitio: 'Sitio Z' }),
      rec({ sitio: null }),
    ];
    const { rows } = buildCrosstab(records, BASE_SITIOS);
    expect(rows.reduce((sum, r) => sum + r.total, 0)).toBe(3);
  });

  it('each row total is the sum of that row cells across every column', () => {
    const records = [
      rec({ category: 'Theft', sitio: 'Sitio A' }),
      rec({ category: 'Theft', sitio: 'Sitio Z' }),
      rec({ category: 'Theft', sitio: null }),
    ];
    const { sitioColumns, rows } = buildCrosstab(records, BASE_SITIOS);
    rows.forEach((r) => {
      const cellSum = sitioColumns.reduce((sum, s) => sum + r[s], 0);
      expect(r.total).toBe(cellSum);
    });
    expect(rows[0].total).toBe(3);
  });

  it('produces no rows and no crash for an empty filtered set', () => {
    const { sitioColumns, rows } = buildCrosstab([], BASE_SITIOS);
    expect(rows).toEqual([]);
    expect(sitioColumns).toEqual(BASE_SITIOS);
  });
});
