import { describe, expect, it } from 'vitest';
import { compareValues, sortRecords, describeSort } from './sortRecords';

/**
 * Sorting is half of checklist item 5.2 ("Reports support filtering and
 * sorting"), and the property that matters for a report is not that some
 * ordering happens — it is that the ordering is CORRECT for the kind of value
 * in the column, and that the array the screen shows is the same array the
 * export writes. This suite covers the first half; the structural guarantee
 * that the export reads the sorted array is asserted in
 * src/pages/reportSortingFlowsToExports.test.js.
 */

const rows = [
  { id: 1, caseNumber: 'CASE-2', date: '2026-03-01', age: 40, sitio: 'Bravo' },
  { id: 2, caseNumber: 'CASE-10', date: '2026-01-15', age: 9, sitio: 'alpha' },
  { id: 3, caseNumber: 'CASE-1', date: '2026-02-20', age: null, sitio: '' },
];

const keys = (result) => result.map((r) => r.id);

describe('compareValues', () => {
  it('orders text case-insensitively', () => {
    expect(compareValues('alpha', 'Bravo', 'text')).toBeLessThan(0);
    expect(compareValues('Bravo', 'alpha', 'text')).toBeGreaterThan(0);
    expect(compareValues('Alpha', 'alpha', 'text')).toBe(0);
  });

  it('orders embedded numbers naturally, not lexically', () => {
    // The failure this prevents: CASE-10 sorting before CASE-2 because '1'
    // precedes '2' character by character. Case numbers are the column a crime
    // report is most often sorted by, and plain lexical order reads as broken.
    expect(compareValues('CASE-2', 'CASE-10', 'text')).toBeLessThan(0);
  });

  it('orders dates chronologically rather than as text', () => {
    expect(compareValues('2026-01-15', '2026-03-01', 'date')).toBeLessThan(0);
    expect(
      compareValues(new Date('2026-03-01'), new Date('2026-01-15'), 'date'),
    ).toBeGreaterThan(0);
  });

  it('orders numbers by magnitude, not by digit string', () => {
    expect(compareValues(9, 40, 'number')).toBeLessThan(0);
    expect(compareValues('9', '40', 'number')).toBeLessThan(0);
  });

  it('sinks blank values below real ones', () => {
    expect(compareValues(null, 'anything', 'text')).toBeGreaterThan(0);
    expect(compareValues('', 'anything', 'text')).toBeGreaterThan(0);
    expect(compareValues(undefined, 5, 'number')).toBeGreaterThan(0);
    expect(compareValues(null, undefined, 'text')).toBe(0);
  });

  it('treats an unparseable date or number as blank rather than as NaN', () => {
    // NaN compares false against everything, so without this the ordering of
    // a column containing one bad value would depend on the input order.
    expect(compareValues('not-a-date', '2026-01-15', 'date')).toBeGreaterThan(
      0,
    );
    expect(compareValues('abc', 5, 'number')).toBeGreaterThan(0);
  });
});

describe('sortRecords', () => {
  it('returns the input array unchanged when no sort is applied', () => {
    // Same reference, not merely equal contents: this is what keeps each
    // page's default ordering (incidents newest-first, audit logs
    // newest-first) intact when nothing has been sorted.
    expect(sortRecords(rows, null)).toBe(rows);
    expect(sortRecords(rows, { key: '' })).toBe(rows);
  });

  it('does not mutate the array it was given', () => {
    const before = keys(rows);
    sortRecords(rows, { key: 'age', direction: 'asc', type: 'number' });
    expect(keys(rows)).toEqual(before);
  });

  it('sorts ascending and descending on the same column', () => {
    const asc = sortRecords(rows, {
      key: 'date',
      direction: 'asc',
      type: 'date',
    });
    expect(keys(asc)).toEqual([2, 3, 1]);

    const desc = sortRecords(rows, {
      key: 'date',
      direction: 'desc',
      type: 'date',
    });
    expect(keys(desc)).toEqual([1, 3, 2]);
  });

  it('keeps blanks last in BOTH directions', () => {
    const asc = sortRecords(rows, {
      key: 'age',
      direction: 'asc',
      type: 'number',
    });
    expect(keys(asc)).toEqual([2, 1, 3]);

    const desc = sortRecords(rows, {
      key: 'age',
      direction: 'desc',
      type: 'number',
    });
    // Row 3 has a null age and stays at the bottom rather than heading the
    // list — a descending column whose first screenful is blank cells has
    // answered no question the user asked.
    expect(keys(desc)).toEqual([1, 2, 3]);
  });

  it('is stable: equal rows keep their original relative order', () => {
    const tied = [
      { id: 'a', status: 'Open' },
      { id: 'b', status: 'Open' },
      { id: 'c', status: 'Closed' },
      { id: 'd', status: 'Open' },
    ];
    const asc = sortRecords(tied, { key: 'status', direction: 'asc' });
    expect(asc.map((r) => r.id)).toEqual(['c', 'a', 'b', 'd']);

    // Ties are NOT reversed along with the direction: toggling a column twice
    // must not silently rearrange rows that compare equal.
    const desc = sortRecords(tied, { key: 'status', direction: 'desc' });
    expect(desc.map((r) => r.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('sorts through a column accessor for non-property values', () => {
    const people = [
      { id: 1, charges: ['Theft', 'Assault'] },
      { id: 2, charges: [] },
      { id: 3, charges: ['Arson'] },
    ];
    const result = sortRecords(people, {
      key: 'charges',
      direction: 'asc',
      value: (row) => (row.charges || []).join(', '),
    });
    // Arson < Theft, and the empty array is blank so it sinks.
    expect(keys(result)).toEqual([3, 1, 2]);
  });

  it('handles an empty or absent row set without throwing', () => {
    expect(sortRecords([], { key: 'date', direction: 'asc' })).toEqual([]);
    expect(sortRecords(undefined, { key: 'date', direction: 'asc' })).toBe(
      undefined,
    );
  });
});

describe('describeSort', () => {
  it('states the default ordering rather than omitting the line', () => {
    // A generated report has to describe its own scope. "No line at all"
    // leaves the reader unable to tell whether the report was ordered.
    expect(describeSort(null)).toBe('Sort: Default order');
  });

  it('names the column and the direction', () => {
    expect(describeSort({ key: 'date', direction: 'asc' }, 'Date')).toBe(
      'Sort: Date (ascending)',
    );
    expect(describeSort({ key: 'date', direction: 'desc' }, 'Date')).toBe(
      'Sort: Date (descending)',
    );
  });

  it('falls back to the column key when no label is supplied', () => {
    expect(describeSort({ key: 'caseNumber', direction: 'asc' })).toBe(
      'Sort: caseNumber (ascending)',
    );
  });
});
