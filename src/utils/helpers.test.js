import { describe, it, expect, vi, afterEach } from 'vitest';
import * as h from './helpers.js';

// Unit tests for the shared helpers. helpers.js is imported by 16 files,
// including all three analytics pages — Dashboard, Statistical Analysis and
// Trend and Pattern Detection — and every statistic those pages report, plus
// every filter the React FilterBar drives, funnels through this one module.
// None of it had ever been executed by a test.
//
// This suite exists BEFORE any analytics calculation is changed, so it records
// what the code does today rather than what a later change might want it to do.
// Three behaviours below are questionable and are pinned, not fixed: mode()
// returning a string for numeric input, linearRegression() returning NaN for a
// degenerate series, and monthLabelToRange() accepting an out-of-range month.
// Each is labelled '(current behaviour)' so that a later phase which corrects
// one is updating an honestly-described expectation rather than contradicting a
// test that claimed the wart was right.
//
// Globals are not enabled — describe/it/expect are imported explicitly — so
// this file needs no oxlint configuration of its own.

describe('TZ pinning', () => {
  it('makes the locale formatters deterministic', () => {
    expect(process.env.TZ).toBe('Asia/Manila');
    expect(h.formatDateTime('2026-08-14T05:07:00Z')).toBe(
      'Aug 14, 2026, 1:07 PM',
    );
    expect(h.formatClockTime('2026-08-14T05:07:00Z')).toBe('1:07 PM');
  });
});

describe('today() — the Manila date boundary', () => {
  afterEach(() => vi.useRealTimers());

  it('returns the Manila date, not the UTC date, in the 00:00-08:00 PH window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T20:00:00Z')); // 04:00 on the 15th in Manila
    // toISOString() is what the code used to do, and it is still a day behind
    // every PH morning. That gap is the whole reason today() exists.
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-08-14');
    expect(h.today()).toBe('2026-08-15');
  });

  it('rolls the month over correctly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T16:30:00Z')); // 00:30 on Sep 1 in Manila
    expect(h.today()).toBe('2026-09-01');
  });
});

describe('statistics — known values, zeros, empty sets', () => {
  it('mean', () => {
    expect(h.mean([1, 2, 3, 4])).toBe(2.5);
    expect(h.mean([0, 0, 0])).toBe(0);
    expect(h.mean([])).toBe(0);
  });

  it('median for odd, even, unsorted and empty input', () => {
    expect(h.median([1, 2, 3, 4])).toBe(2.5);
    expect(h.median([3, 1, 2])).toBe(2);
    expect(h.median([])).toBe(0);
  });

  it('variance is the SAMPLE variance, dividing by n-1', () => {
    expect(h.variance([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(4.5714285, 6);
    // No spread, a single value (where n-1 would divide by zero), and nothing
    // at all all collapse to 0 rather than NaN.
    expect(h.variance([3, 3, 3])).toBe(0);
    expect(h.variance([5])).toBe(0);
    expect(h.variance([])).toBe(0);
  });

  it('stdDev', () => {
    expect(h.stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.1380899, 6);
    expect(h.stdDev([])).toBe(0);
  });

  it('mode returns null for an empty set', () => {
    expect(h.mode([])).toBeNull();
  });

  it('mode returns the key as a STRING even for numeric input (current behaviour)', () => {
    // Object.entries() stringifies keys, and modeVal — initialised to arr[0], a
    // number — is always overwritten by the string key. Pinned, not fixed:
    // correcting it is an analytics calculation change.
    expect(h.mode([1, 1, 2])).toBe('1');
    expect(typeof h.mode([1, 1, 2])).toBe('string');
    expect(h.mode(['a', 'b', 'b'])).toBe('b');
  });
});

describe('linearRegression', () => {
  it('known slope and intercept', () => {
    expect(
      h.linearRegression([
        [0, 0],
        [1, 1],
        [2, 2],
      ]),
    ).toEqual({ slope: 1, intercept: 0 });
    expect(
      h.linearRegression([
        [0, 10],
        [1, 5],
        [2, 0],
      ]),
    ).toEqual({ slope: -5, intercept: 10 });
    expect(
      h.linearRegression([
        [0, 4],
        [1, 4],
      ]),
    ).toEqual({ slope: 0, intercept: 4 });
  });

  it('degenerate input returns a flat line', () => {
    expect(h.linearRegression([])).toEqual({ slope: 0, intercept: 0 });
    expect(h.linearRegression([[1, 5]])).toEqual({ slope: 0, intercept: 0 });
  });

  it('identical x values divide by zero and yield NaN (current behaviour)', () => {
    // n*sumX2 - sumX*sumX is 0 when every x is the same, so this is 0/0. Trends
    // feeds the slope into its forecast, so a degenerate series forecasts NaN.
    // Pinned, not fixed — clamping the forecast is roadmap item 3.2.
    const r = h.linearRegression([
      [1, 2],
      [1, 3],
    ]);
    expect(Number.isNaN(r.slope)).toBe(true);
    expect(Number.isNaN(r.intercept)).toBe(true);
  });
});

describe('movingAverage', () => {
  it('uses a trailing window with partial windows at the start', () => {
    // The first two entries average fewer than `window` points because there is
    // no earlier data, rather than being omitted or zero-filled.
    expect(h.movingAverage([1, 2, 3, 4, 5])).toEqual([1, 1.5, 2, 3, 4]);
  });

  it('empty set, window wider than the data, window of one', () => {
    expect(h.movingAverage([], 3)).toEqual([]);
    expect(h.movingAverage([5], 3)).toEqual([5]);
    expect(h.movingAverage([1, 2, 3], 1)).toEqual([1, 2, 3]);
  });
});

describe('monthLabelToRange — month and year boundaries', () => {
  it('31-day, 30-day, February and leap February', () => {
    expect(h.monthLabelToRange('2026-01')).toEqual({
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    });
    expect(h.monthLabelToRange('2026-04')).toEqual({
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
    });
    expect(h.monthLabelToRange('2026-02')).toEqual({
      dateFrom: '2026-02-01',
      dateTo: '2026-02-28',
    });
    expect(h.monthLabelToRange('2024-02')).toEqual({
      dateFrom: '2024-02-01',
      dateTo: '2024-02-29',
    });
  });

  it('December does not roll into the next year', () => {
    expect(h.monthLabelToRange('2026-12')).toEqual({
      dateFrom: '2026-12-01',
      dateTo: '2026-12-31',
    });
  });

  it('a missing or malformed label yields an undefined range', () => {
    // An undefined range means "no date filtering", which is what a cleared
    // month selection has to mean.
    const none = { dateFrom: undefined, dateTo: undefined };
    expect(h.monthLabelToRange('')).toEqual(none);
    expect(h.monthLabelToRange(null)).toEqual(none);
    expect(h.monthLabelToRange(undefined)).toEqual(none);
    expect(h.monthLabelToRange('2026-1')).toEqual(none);
    expect(h.monthLabelToRange('not-a-month')).toEqual(none);
  });

  it('an out-of-range month passes the regex and yields an impossible range (current behaviour)', () => {
    // /^\d{4}-\d{2}$/ does not bound the month, so '2026-13' produces a date
    // string that can never match a record in filterRecords' lexical
    // comparison. Not currently reachable — real labels come from grouping over
    // actual dates — so it is pinned rather than fixed.
    expect(h.monthLabelToRange('2026-13')).toEqual({
      dateFrom: '2026-13-01',
      dateTo: '2026-13-31',
    });
  });
});

describe('groupBy / countBy', () => {
  it('buckets absent values under UNCATEGORISED', () => {
    // Without this, a null category becomes the STRING "null" and a printed
    // barangay report shows a pie slice labelled "null".
    const g = h.groupBy(
      [{ c: 'A' }, { c: null }, { c: '' }, {}, { c: 'A' }],
      'c',
    );
    expect(Object.keys(g).sort()).toEqual(['A', h.UNCATEGORISED]);
    expect(g.A).toHaveLength(2);
    expect(g[h.UNCATEGORISED]).toHaveLength(3);
  });

  it('preserves 0 and false rather than swallowing them', () => {
    // A truthiness check here would rebucket a legitimate count of 0.
    expect(Object.keys(h.groupBy([{ n: 0 }, { n: 1 }], 'n')).sort()).toEqual([
      '0',
      '1',
    ]);
    expect(Object.keys(h.groupBy([{ b: false }], 'b'))).toEqual(['false']);
  });

  it('supports a callback key and an empty set', () => {
    expect(
      Object.keys(h.groupBy([{ a: 'x', b: 'y' }], (r) => `${r.a}|${r.b}`)),
    ).toEqual(['x|y']);
    expect(h.groupBy([], 'c')).toEqual({});
  });

  it('countBy counts each bucket', () => {
    expect(h.countBy([{ c: 'A' }, { c: 'A' }, { c: null }], 'c')).toEqual({
      A: 2,
      [h.UNCATEGORISED]: 1,
    });
    expect(h.countBy([], 'c')).toEqual({});
  });
});

describe('filterRecords', () => {
  const recs = [
    {
      date: '2026-08-01',
      crimeType: 'Theft',
      category: 'Property',
      sitio: 'A',
      status: 'Open',
      caseNumber: 'CN-1',
      street: 'Rizal',
      reportingOfficer: 'PO1 Cruz',
    },
    {
      date: '2026-08-14',
      crimeType: 'Assault',
      category: 'Person',
      sitio: 'B',
      status: 'Solved',
      caseNumber: 'CN-2',
      street: 'Bonifacio',
      reportingOfficer: 'PO2 Reyes',
    },
    {
      date: '2026-08-31',
      crimeType: 'Theft',
      category: 'Property',
      sitio: null,
      status: 'Closed',
      caseNumber: 'CN-3',
      street: 'Mabini',
      reportingOfficer: 'PO3 Santos',
    },
  ];

  it('empty filters mean no filtering', () => {
    // The standing rule for the FilterBar: a cleared filter shows all data.
    expect(h.filterRecords(recs, {})).toHaveLength(3);
    expect(
      h.filterRecords(recs, {
        crimeType: '',
        sitio: '',
        status: '',
        search: '',
      }),
    ).toHaveLength(3);
  });

  it('FROM and TO are both inclusive', () => {
    expect(h.filterRecords(recs, { dateFrom: '2026-08-01' })).toHaveLength(3);
    expect(h.filterRecords(recs, { dateTo: '2026-08-31' })).toHaveLength(3);
    expect(
      h
        .filterRecords(recs, { dateFrom: '2026-08-14', dateTo: '2026-08-14' })
        .map((r) => r.caseNumber),
    ).toEqual(['CN-2']);
  });

  it('excludes records outside the range', () => {
    expect(
      h
        .filterRecords(recs, { dateFrom: '2026-08-02', dateTo: '2026-08-30' })
        .map((r) => r.caseNumber),
    ).toEqual(['CN-2']);
  });

  it('search is case-insensitive and tolerates a null sitio', () => {
    expect(h.filterRecords(recs, { search: 'THEFT' })).toHaveLength(2);
    expect(
      h.filterRecords(recs, { search: 'mabini' }).map((r) => r.caseNumber),
    ).toEqual(['CN-3']);
  });

  it('an empty record set stays empty', () => {
    expect(h.filterRecords([], { crimeType: 'Theft' })).toEqual([]);
  });

  it('the status vocabularies are disjoint', () => {
    // Resolution Rate depends on solved + pending = total, which only holds
    // while these two sets do not overlap.
    expect(h.SOLVED_STATUSES).toEqual(['Solved', 'Closed']);
    expect(h.PENDING_STATUSES).toEqual(['Open', 'Under Investigation']);
    expect(
      h.SOLVED_STATUSES.filter((s) => h.PENDING_STATUSES.includes(s)),
    ).toEqual([]);
  });
});

describe('formatting', () => {
  it('formatDate', () => {
    expect(h.formatDate('2026-08-14')).toBe('Aug 14, 2026');
    expect(h.formatDate('2026-12-31')).toBe('Dec 31, 2026');
    expect(h.formatDate('')).toBe('—');
    expect(h.formatDate('—')).toBe('—');
    // An unparseable value comes back untouched rather than as "Invalid Date".
    expect(h.formatDate('not-a-date')).toBe('not-a-date');
  });

  it('formatTime handles the noon and midnight boundaries', () => {
    expect(h.formatTime('13:05')).toBe('1:05 PM');
    expect(h.formatTime('00:30')).toBe('12:30 AM');
    expect(h.formatTime('12:00')).toBe('12:00 PM');
    expect(h.formatTime('')).toBe('—');
    expect(h.formatTime('9')).toBe('9');
  });

  it('formatDateTime and formatClockTime return null rather than a placeholder', () => {
    // Null, not a string, so each caller picks its own wording — "Never" for a
    // sign-in that has not happened, "Not available" for data not held.
    expect(h.formatDateTime(null)).toBeNull();
    expect(h.formatDateTime('nope')).toBeNull();
    expect(h.formatClockTime(null)).toBeNull();
  });
});

describe('relativeTime', () => {
  afterEach(() => vi.useRealTimers());

  it('handles empty, invalid, recent, future-skewed and old values', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T12:00:00Z'));
    expect(h.relativeTime('')).toBe('');
    expect(h.relativeTime('nope')).toBe('');
    expect(h.relativeTime('2026-08-14T11:59:30Z')).toBe('Just now');
    // Clock skew can put a just-created notification in the future; "in 4
    // seconds" would be absurd, so anything within a minute reads as Just now.
    expect(h.relativeTime('2026-08-14T12:00:30Z')).toBe('Just now');
    expect(h.relativeTime('2026-08-14T11:30:00Z')).toBe('30 minutes ago');
    expect(h.relativeTime('2026-08-14T09:00:00Z')).toBe('3 hours ago');
    expect(h.relativeTime('2026-08-12T12:00:00Z')).toBe('2 days ago');
    // Older than a week falls back to a plain date.
    expect(h.relativeTime('2026-07-01T12:00:00Z')).toBe('Jul 1, 2026');
  });
});

// ---------------------------------------------------------------------------
// Roadmap 3.2 — the forecast must never be negative.
//
// Trends extrapolates one month past the data by evaluating the regression line
// at x = monthKeys.length. On any sufficiently declining series that value goes
// below zero, and the chart then forecasts a negative number of crimes for next
// month — which is not a pessimistic estimate, it is an impossible one, and it
// is printed in a barangay report.
//
// Only the EXTRAPOLATED point is clamped. The historical fitted values stay
// exactly as linearRegression produced them: they describe the line through
// data that actually happened, and flattening them at zero would misrepresent
// the fit the chart is drawing. linearRegression() itself is unchanged.
// ---------------------------------------------------------------------------
describe('forecastNext — roadmap 3.2 non-negative clamp', () => {
  it('returns the plain extrapolation when it is positive', () => {
    // counts [1,3,5] -> slope 2, intercept 1; next month = 2*3 + 1 = 7
    expect(h.forecastNext(2, 1, 3)).toBe(7);
  });

  it('clamps a negative extrapolation to zero', () => {
    // counts [5,3,1] -> slope -2, intercept 5; next month = -2*3 + 5 = -1
    expect(h.forecastNext(-2, 5, 3)).toBe(0);
  });

  it('clamps a steeply negative extrapolation to zero', () => {
    expect(h.forecastNext(-10, 4, 3)).toBe(0);
  });

  it('keeps zero as zero', () => {
    expect(h.forecastNext(-1, 3, 3)).toBe(0);
  });

  it('keeps the existing one-decimal rounding', () => {
    expect(h.forecastNext(1.24, 0, 1)).toBe(1.2);
    expect(h.forecastNext(1.26, 0, 1)).toBe(1.3);
  });

  it('does not clamp the historical regression line, only the extrapolation', () => {
    // The fitted value at an EARLIER x may legitimately be negative; that is the
    // line the chart draws through real data and is left untouched. This test
    // pins the boundary of the fix: the same arithmetic, unclamped, is what
    // Trends still uses for the historical series.
    const { slope, intercept } = h.linearRegression([
      [0, 1],
      [1, 0],
      [2, 0],
    ]);
    const historical = [0, 1, 2].map(
      (i) => +(slope * i + intercept).toFixed(1),
    );
    expect(historical.some((v) => v < 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Roadmap 3.3 — a continuous month axis with zero-filled missing months.
//
// Trends and Dashboard built the axis from whatever month keys happened to
// exist, and plotted them at x = array index. A month with no matching
// incidents produced no key, so the gap silently closed: February and May were
// drawn adjacent and equally spaced, and the regression fitted a line through a
// timeline that had been compressed. On a 2/4/-/-/6 series that inflated the
// slope 5x (2.0 against 0.4) and the forecast from 3.6 to 8.
//
// Interior gaps only, by decision: first present month through last present
// month. The axis is NOT expanded to the filter's requested range.
// ---------------------------------------------------------------------------
describe('continuousMonths — roadmap 3.3 zero-filled month axis', () => {
  it('fills an interior gap', () => {
    expect(
      h.continuousMonths({ '2026-01': 2, '2026-02': 4, '2026-05': 6 }),
    ).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']);
  });

  it('leaves an already-continuous run untouched', () => {
    expect(
      h.continuousMonths({ '2026-01': 1, '2026-02': 2, '2026-03': 3 }),
    ).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('crosses a year boundary', () => {
    expect(h.continuousMonths({ '2025-11': 3, '2026-02': 1 })).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('spans more than a full year', () => {
    const out = h.continuousMonths({ '2025-01': 1, '2026-03': 1 });
    expect(out).toHaveLength(15);
    expect(out[0]).toBe('2025-01');
    expect(out[14]).toBe('2026-03');
    expect(out).toContain('2025-12');
    expect(out).toContain('2026-01');
  });

  it('returns a single month unchanged and an empty set as empty', () => {
    expect(h.continuousMonths({ '2026-07': 5 })).toEqual(['2026-07']);
    expect(h.continuousMonths({})).toEqual([]);
  });

  it('sorts unordered input ascending', () => {
    expect(
      h.continuousMonths({ '2026-03': 1, '2026-01': 1, '2026-02': 1 }),
    ).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('does not invent counts — the caller reads absent months as zero', () => {
    const counts = { '2026-01': 2, '2026-04': 6 };
    const axis = h.continuousMonths(counts);
    expect(axis.map((m) => counts[m] ?? 0)).toEqual([2, 0, 0, 6]);
    // The source object is not mutated.
    expect(Object.keys(counts).sort()).toEqual(['2026-01', '2026-04']);
  });

  it('makes the regression measure real elapsed months, not surviving keys', () => {
    // The defect in one assertion: the same records, compressed vs continuous.
    const counts = { '2026-01': 2, '2026-02': 4, '2026-05': 6 };

    const compressed = Object.keys(counts).sort();
    const compressedFit = h.linearRegression(
      compressed.map((m, i) => [i, counts[m]]),
    );

    const axis = h.continuousMonths(counts);
    const continuousFit = h.linearRegression(
      axis.map((m, i) => [i, counts[m] ?? 0]),
    );

    expect(compressedFit.slope).toBe(2);
    expect(continuousFit.slope).toBeCloseTo(0.4, 10);
    expect(
      h.forecastNext(compressedFit.slope, compressedFit.intercept, 3),
    ).toBe(8);
    expect(
      h.forecastNext(continuousFit.slope, continuousFit.intercept, 5),
    ).toBe(3.6);
  });
});

// ---------------------------------------------------------------------------
// Roadmap 3.4 — the Analytics monthly series must be keyed by YYYY-MM.
//
// Analytics grouped its monthly chart by month NAME with the year discarded:
//   countBy(filtered, r => new Date(...).toLocaleString('en', {month:'short'}))
// then ordered the result from a hard-coded ['Jan'...'Dec'] array. A display
// format was being used as a grouping key, and it is not injective over time.
//
// Two consequences, both reproduced below. On a rolling Sep-to-Aug window — the
// shape the seeder produces, and the default unfiltered view — the series is
// rendered 2026 months first, so a monotonically rising count is drawn rising
// and then collapsing off a cliff that does not exist in the data. And on any
// range covering the same calendar month in two years, both are summed into one
// bar, which also makes the chart's own average disagree with the Mean
// (monthly) figure in the statistics table on the same page.
//
// These tests characterise the GROUPING STRATEGY, using the same countBy the
// page calls. They are not a test of Analytics.jsx itself: its month logic sits
// inside the component body and is not exported, and exporting it would make a
// component file export a non-component, which is the react-refresh warning
// this project keeps at zero. Analytics.jsx is covered here by the build and by
// review of its diff.
// ---------------------------------------------------------------------------
describe('Analytics month key — roadmap 3.4 YYYY-MM grouping', () => {
  // The key Analytics uses for its monthly series.
  const monthKeyOf = (r) => r.date.slice(0, 7);

  // What it used to use, kept only so these tests state what was wrong.
  const legacyMonthNameKey = (r) =>
    new Date(`${r.date}T00:00:00`).toLocaleString('en', { month: 'short' });

  const days = (month, n) =>
    Array.from({ length: n }, (_, i) => ({
      date: `${month}-${String(i + 1).padStart(2, '0')}`,
    }));

  it('keeps two different years apart instead of summing them', () => {
    const recs = [...days('2025-01', 10), ...days('2026-01', 1)];

    // The defect, stated: the old key collapsed both Januaries into one bucket.
    const legacy = h.countBy(recs, legacyMonthNameKey);
    expect(Object.keys(legacy)).toEqual(['Jan']);
    expect(legacy.Jan).toBe(11);

    const byMonth = h.countBy(recs, monthKeyOf);
    expect(Object.keys(byMonth).sort()).toEqual(['2025-01', '2026-01']);
    expect(byMonth['2025-01']).toBe(10);
    expect(byMonth['2026-01']).toBe(1);
  });

  it('sorts chronologically across a year boundary', () => {
    const recs = [...days('2025-12', 2), ...days('2026-01', 3)];
    expect(Object.keys(h.countBy(recs, monthKeyOf)).sort()).toEqual([
      '2025-12',
      '2026-01',
    ]);
  });

  it('renders a rolling Sep-to-Aug window in true order, with no cliff', () => {
    // Twelve months, counts rising 3..14. The old calendar-order axis drew
    // 7,8,...,14 then dropped to 3 at Sep.
    const recs = [
      ...days('2025-09', 3),
      ...days('2025-10', 4),
      ...days('2025-11', 5),
      ...days('2025-12', 6),
      ...days('2026-01', 7),
      ...days('2026-02', 8),
      ...days('2026-03', 9),
      ...days('2026-04', 10),
      ...days('2026-05', 11),
      ...days('2026-06', 12),
      ...days('2026-07', 13),
      ...days('2026-08', 14),
    ];
    const byMonth = h.countBy(recs, monthKeyOf);
    const months = h.continuousMonths(byMonth);
    const values = months.map((m) => byMonth[m] ?? 0);

    expect(months[0]).toBe('2025-09');
    expect(months[months.length - 1]).toBe('2026-08');
    expect(values).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    // Monotonic: every step is an increase, so there is no fabricated cliff.
    expect(values.every((v, i) => i === 0 || v > values[i - 1])).toBe(true);
  });

  it('uses the same continuous axis as Trends and Dashboard', () => {
    const recs = [...days('2026-01', 2), ...days('2026-04', 6)];
    const byMonth = h.countBy(recs, monthKeyOf);
    const months = h.continuousMonths(byMonth);
    expect(months).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    expect(months.map((m) => byMonth[m] ?? 0)).toEqual([2, 0, 0, 6]);
  });

  it('makes the chart agree with the Mean (monthly) figure beside it', () => {
    const recs = [
      ...days('2025-01', 10),
      ...days('2025-02', 2),
      ...days('2025-03', 2),
      ...days('2026-01', 1),
      ...days('2026-02', 2),
      ...days('2026-03', 3),
    ];
    const byMonth = h.countBy(recs, monthKeyOf);

    // The measures read the months PRESENT — zero-filled months are not real
    // observations and must not enter the mean. This is Object.values(byMonth),
    // which is exactly what the page recomputed separately before.
    const monthlyCounts = Object.values(byMonth);
    expect(monthlyCounts).toHaveLength(6);
    expect(h.mean(monthlyCounts).toFixed(2)).toBe('3.33');

    // Under the old key the chart saw three buckets and a mean of 6.7, while
    // the table beside it said 3.33.
    const legacyValues = Object.values(h.countBy(recs, legacyMonthNameKey));
    expect(legacyValues).toHaveLength(3);
    expect(h.mean(legacyValues).toFixed(2)).toBe('6.67');
  });

  it('handles a single month and an empty set', () => {
    expect(Object.keys(h.countBy(days('2026-07', 4), monthKeyOf))).toEqual([
      '2026-07',
    ]);
    expect(h.countBy([], monthKeyOf)).toEqual({});
    expect(h.continuousMonths(h.countBy([], monthKeyOf))).toEqual([]);
  });
});
