import { describe, expect, it } from 'vitest';
import {
  buildCategoryInsight,
  buildCrimeTrendInsight,
  buildCrimeTypeInsight,
  buildDailyPatternInsight,
  buildForecastInsight,
  buildRegressionInsight,
  buildResolutionInsight,
  buildSitioInsight,
  buildStatusInsight,
} from './chartInsights';
import { DAY_NAMES } from './constants';

/**
 * Coverage for src/utils/chartInsights.js — the analysis sentences and KPI
 * cards rendered beneath the Crime Reporting Dashboard and Trend and Pattern
 * Detection charts, and printed into barangay reports.
 *
 * These are characterisation tests: every expectation below is the behaviour
 * the module already has. Nothing here changes a formula, a threshold or a
 * wording; the point is that a future edit to the arithmetic or the phrasing
 * has to be a deliberate one. Because the sentences are printed verbatim, the
 * wording is part of the behaviour and is asserted as whole strings rather
 * than matched loosely.
 */

describe('chartInsights — empty-data guards', () => {
  it('names the chart it has no data for, and emits no KPI cards', () => {
    // Each builder has its own guard sentence; a shared one would tell a
    // reader which chart is empty only by where it happens to appear.
    const cases = [
      [
        buildCrimeTrendInsight([], []),
        'No incident data available for the selected range.',
      ],
      [
        buildCategoryInsight([], []),
        'No category data available for the selected range.',
      ],
      [
        buildSitioInsight([], []),
        'No sitio data available for the selected range.',
      ],
      [
        buildCrimeTypeInsight([], []),
        'No crime type data available for the selected range.',
      ],
      [
        buildResolutionInsight([], []),
        'No resolution rate data available for the selected range.',
      ],
      [
        buildStatusInsight([], []),
        'No status data available for the selected range.',
      ],
      [
        buildDailyPatternInsight([], []),
        'No incident data available for the selected range.',
      ],
      [
        buildForecastInsight([], [], []),
        'No incident data available for the selected range.',
      ],
    ];

    cases.forEach(([result, sentence]) => {
      expect(result.insight).toBe(sentence);
      expect(result.kpis).toEqual([]);
    });
  });

  it('reports no data rather than a 0/0 share when every bucket is zero', () => {
    // The status and daily-pattern guards test the total, not the array
    // length: a filtered range that matches no incidents still arrives with a
    // full set of labels and all-zero counts.
    const status = buildStatusInsight(
      ['Open', 'Under Investigation', 'Solved', 'Closed'],
      [0, 0, 0, 0],
    );
    expect(status.insight).toBe(
      'No status data available for the selected range.',
    );
    expect(status.kpis).toEqual([]);

    const daily = buildDailyPatternInsight(DAY_NAMES, [0, 0, 0, 0, 0, 0, 0]);
    expect(daily.insight).toBe(
      'No incident data available for the selected range.',
    );
    expect(daily.kpis).toEqual([]);
  });

  it('does not leak -Infinity or NaN from an empty daily series', () => {
    // Math.max() with no arguments is -Infinity; the guard is what keeps that
    // out of the printed sentence.
    const { insight } = buildDailyPatternInsight([], []);
    expect(insight).not.toMatch(/Infinity|NaN|undefined/);
  });
});

describe('buildCrimeTrendInsight — peak, latest and first→latest change', () => {
  const labels = ['Jan', 'Feb', 'Mar'];
  const values = [10, 25, 15];

  it('describes the peak and the fall away from it', () => {
    expect(buildCrimeTrendInsight(labels, values).insight).toBe(
      'Incident volume peaked in Feb with 25 recorded incidents, while the latest period recorded 15 incidents, representing a 40% decrease from the peak.',
    );
  });

  it('reports total, extremes, average and the signed first→latest change', () => {
    expect(buildCrimeTrendInsight(labels, values).kpis).toEqual([
      { label: 'Total Incidents', value: 50, cls: 'accent' },
      { label: 'Highest Month', value: 'Feb (25)', cls: 'danger' },
      { label: 'Lowest Month', value: 'Jan (10)', cls: 'success' },
      { label: 'Monthly Average', value: 16.7, cls: 'info' },
      { label: 'Change (First → Latest)', value: '+5 (+50%)', cls: 'danger' },
    ]);
  });

  it('marks a fall in incidents as success and signs it negatively', () => {
    // Fewer incidents is a good outcome, so the card is green even though the
    // number is negative — the opposite of the resolution-rate convention.
    const change = buildCrimeTrendInsight(['Jan', 'Feb'], [20, 10]).kpis[4];
    expect(change).toEqual({
      label: 'Change (First → Latest)',
      value: '-10 (-50%)',
      cls: 'success',
    });
  });

  it('calls the latest period an increase when it is itself the peak', () => {
    const { insight } = buildCrimeTrendInsight(['Jan', 'Feb'], [10, 25]);
    expect(insight).toBe(
      'Incident volume peaked in Feb with 25 recorded incidents, while the latest period recorded 25 incidents, representing a 0% increase from the peak.',
    );
  });

  it('relabels the unit for Weekly Trends without changing the maths', () => {
    // Trends.jsx reuses this function with unitLabel='Week'. Only the KPI
    // labels differ; the sentence and every number stay identical.
    const monthly = buildCrimeTrendInsight(labels, values);
    const weekly = buildCrimeTrendInsight(labels, values, 'Week');
    expect(weekly.insight).toBe(monthly.insight);
    expect(weekly.kpis.map((k) => k.label)).toEqual([
      'Total Incidents',
      'Highest Week',
      'Lowest Week',
      'Weekly Average',
      'Change (First → Latest)',
    ]);
    expect(weekly.kpis.map((k) => k.value)).toEqual(
      monthly.kpis.map((k) => k.value),
    );
  });
});

describe('buildCrimeTrendInsight — zero-denominator percentage change', () => {
  it('reports a rise from zero as +100% rather than Infinity', () => {
    // (latest - 0) / 0 is Infinity, which would print as "+Infinity%". A
    // first period of zero that grows is reported as a full 100% increase.
    const { insight, kpis } = buildCrimeTrendInsight(['W1', 'W2'], [0, 5]);
    expect(kpis[4].value).toBe('+5 (+100%)');
    expect(insight).not.toMatch(/Infinity|NaN/);
  });

  it('reports zero-to-zero as no change, not 100%', () => {
    const { insight, kpis } = buildCrimeTrendInsight(['W1', 'W2'], [0, 0]);
    expect(kpis[4]).toEqual({
      label: 'Change (First → Latest)',
      value: '+0 (+0%)',
      cls: 'success',
    });
    // A zero peak also drives the change-from-peak share to 0 instead of NaN.
    expect(insight).toBe(
      'Incident volume peaked in W1 with 0 recorded incidents, while the latest period recorded 0 incidents, representing a 0% increase from the peak.',
    );
  });

  it('handles a single period as its own peak, low and average', () => {
    const { insight, kpis } = buildCrimeTrendInsight(['Jan'], [7]);
    expect(insight).toBe(
      'Incident volume peaked in Jan with 7 recorded incidents, while the latest period recorded 7 incidents, representing a 0% increase from the peak.',
    );
    expect(kpis.map((k) => k.value)).toEqual([
      7,
      'Jan (7)',
      'Jan (7)',
      7,
      '+0 (+0%)',
    ]);
  });
});

describe('ranked insights — category, sitio and crime type', () => {
  const labels = ['Theft', 'Assault', 'Fraud'];
  const values = [30, 15, 5];

  it('leads with the top entry and its share of the total', () => {
    expect(buildCategoryInsight(labels, values).insight).toBe(
      'Theft is the leading category with 30 incidents, representing 60% of all recorded incidents.',
    );
    expect(buildSitioInsight(['Sitio A', 'Sitio B'], [30, 20]).insight).toBe(
      'Sitio A has the highest recorded incident volume with 30 incidents, representing 60% of all incidents.',
    );
    expect(buildCrimeTypeInsight(labels, values).insight).toBe(
      'Theft is the most common crime type with 30 incidents, representing 60% of all recorded incidents.',
    );
  });

  it('gives each chart its own KPI vocabulary over the same ranking', () => {
    expect(buildCategoryInsight(labels, values).kpis).toEqual([
      { label: 'Total Incidents', value: 50, cls: 'accent' },
      { label: 'Leading Category', value: 'Theft (30)', cls: 'danger' },
      { label: 'Leading Share', value: '60%', cls: 'warning' },
      { label: 'Lowest Category', value: 'Fraud (5)', cls: 'success' },
      { label: 'Categories Recorded', value: 3, cls: 'info' },
    ]);
    expect(buildSitioInsight(labels, values).kpis.map((k) => k.label)).toEqual([
      'Total Incidents',
      'Highest Sitio',
      'Highest Share',
      'Lowest Sitio',
      'Sitios Recorded',
    ]);
    expect(
      buildCrimeTypeInsight(labels, values).kpis.map((k) => k.label),
    ).toEqual([
      'Total Incidents',
      'Most Common',
      'Leading Share',
      'Least Common',
      'Crime Types Recorded',
    ]);
  });

  it('ranks by value, not by the order the chart supplied', () => {
    const { insight, kpis } = buildCategoryInsight(labels, [5, 30, 15]);
    expect(insight).toMatch(/^Assault is the leading category with 30 /);
    expect(kpis[3].value).toBe('Theft (5)');
  });

  it('resolves a tie for the lead in favour of the earlier label', () => {
    // The pages pass an already-sorted series, so keeping the input order for
    // equal values keeps the sentence agreeing with the chart's first bar.
    const { kpis } = buildCategoryInsight(['A', 'B', 'C'], [5, 5, 1]);
    expect(kpis[1].value).toBe('A (5)');
  });

  it('rounds the leading share to one decimal place', () => {
    expect(buildCategoryInsight(['A', 'B', 'C'], [1, 1, 1]).kpis[2].value).toBe(
      '33.3%',
    );
  });

  it('counts a label with no matching value as zero', () => {
    const { kpis } = buildCategoryInsight(['A', 'B'], [5]);
    expect(kpis[0].value).toBe(5);
    expect(kpis[3].value).toBe('B (0)');
    expect(kpis[4].value).toBe(2);
  });

  it('reports a 0% share instead of NaN when every category is zero', () => {
    // These builders guard on having entries, not on the total, so an
    // all-zero ranking still renders — the share divides by a zero total and
    // must come back 0.
    const { insight, kpis } = buildCategoryInsight(['A', 'B'], [0, 0]);
    expect(insight).toBe(
      'A is the leading category with 0 incidents, representing 0% of all recorded incidents.',
    );
    expect(kpis[2].value).toBe('0%');
    expect(insight).not.toMatch(/NaN/);
  });
});

describe('buildResolutionInsight — percentages, not counts', () => {
  const labels = ['Jan', 'Feb', 'Mar'];

  it('reports the first→latest move in percentage points', () => {
    const { insight } = buildResolutionInsight(labels, [40, 75, 60]);
    expect(insight).toBe(
      'Case resolution has improved from 40% to 60% across the selected period, a change of +20 percentage points. The rate peaked at 75% in Feb and dipped to a low of 40% in Jan.',
    );
  });

  it('marks the latest rate against the period average', () => {
    // Above the average is a success card, below it a warning — the latest
    // value is judged relative to the period, not to a fixed target.
    expect(buildResolutionInsight(labels, [40, 75, 60]).kpis).toEqual([
      { label: 'Latest Resolution Rate', value: '60%', cls: 'success' },
      { label: 'Highest Rate', value: '75% (Feb)', cls: 'success' },
      { label: 'Lowest Rate', value: '40% (Jan)', cls: 'danger' },
      { label: 'Average Rate', value: '58.3%', cls: 'info' },
      { label: 'Change (First → Latest)', value: '+20 pts', cls: 'success' },
    ]);
    expect(buildResolutionInsight(labels, [80, 90, 40]).kpis[0].cls).toBe(
      'warning',
    );
  });

  it('calls a falling rate a decline and marks the change as a danger', () => {
    // The opposite convention to the incident-count charts: here a fall is
    // bad news, so the negative change is red.
    const { insight, kpis } = buildResolutionInsight(['Jan', 'Feb'], [80, 50]);
    expect(insight).toMatch(/^Case resolution has declined from 80% to 50% /);
    expect(kpis[4]).toEqual({
      label: 'Change (First → Latest)',
      value: '-30 pts',
      cls: 'danger',
    });
  });

  it('rounds away floating-point noise in the change', () => {
    // 66.7 - 33.3 is 33.400000000000006 in IEEE-754; the printed sentence
    // must not carry that tail.
    const { insight, kpis } = buildResolutionInsight(
      ['Jan', 'Feb'],
      [33.3, 66.7],
    );
    expect(kpis[4].value).toBe('+33.4 pts');
    expect(insight).toContain('a change of +33.4 percentage points');
  });

  it('treats a flat rate as improved with a zero change', () => {
    const { insight } = buildResolutionInsight(['Jan', 'Feb'], [50, 50]);
    expect(insight).toMatch(/^Case resolution has improved from 50% to 50% /);
    expect(insight).toContain('a change of +0 percentage points');
  });
});

describe('buildStatusInsight — resolved and unresolved shares', () => {
  const labels = ['Open', 'Under Investigation', 'Solved', 'Closed'];

  it('leads on the open share when any case is still open', () => {
    const { insight, kpis } = buildStatusInsight(labels, [10, 5, 20, 15]);
    expect(insight).toBe(
      'Open cases represent 20% of recorded incidents, indicating that a significant portion of cases remains unresolved.',
    );
    expect(kpis).toEqual([
      { label: 'Total Incidents', value: 50, cls: 'accent' },
      { label: 'Open', value: 10, cls: 'danger' },
      { label: 'Under Investigation', value: 5, cls: 'warning' },
      { label: 'Solved / Closed', value: 35, cls: 'success' },
      { label: 'Unresolved Share', value: '30%', cls: 'danger' },
      { label: 'Resolved Share', value: '70%', cls: 'success' },
    ]);
  });

  it('falls back to the combined unresolved share when nothing is open', () => {
    const { insight, kpis } = buildStatusInsight(
      ['Under Investigation', 'Solved', 'Closed'],
      [5, 20, 15],
    );
    expect(insight).toBe(
      '12.5% of recorded incidents remain unresolved (Open or Under Investigation).',
    );
    expect(kpis[1]).toEqual({ label: 'Open', value: 0, cls: 'danger' });
  });

  it('groups Solved with Closed and Open with Under Investigation', () => {
    const { kpis } = buildStatusInsight(labels, [1, 1, 1, 1]);
    expect(kpis[3].value).toBe(2);
    expect(kpis[4].value).toBe('50%');
    expect(kpis[5].value).toBe('50%');
  });

  it('counts Archived in the total but in neither share (current behaviour)', () => {
    // 'Archived' is part of the STATUSES vocabulary but is not one of the four
    // buckets this builder recognises, so with archived incidents present the
    // two shares do not add up to 100%. Pinned as-is: which statuses count as
    // resolved is a product decision, not a test fix.
    const { kpis } = buildStatusInsight(
      [...labels, 'Archived'],
      [10, 5, 20, 15, 10],
    );
    expect(kpis[0].value).toBe(60);
    expect(kpis[4].value).toBe('25%');
    expect(kpis[5].value).toBe('58.3%');
  });

  it('ignores an unrecognised status label rather than throwing', () => {
    const { kpis } = buildStatusInsight(['Open', 'Referred'], [3, 7]);
    expect(kpis[0].value).toBe(10);
    expect(kpis[1].value).toBe(3);
    expect(kpis[3].value).toBe(0);
  });
});

describe('buildDailyPatternInsight — busiest and quietest days', () => {
  it('names a single busiest and quietest day', () => {
    const { insight, kpis } = buildDailyPatternInsight(
      DAY_NAMES,
      [3, 5, 2, 4, 6, 8, 1],
    );
    expect(insight).toBe(
      'Friday recorded the highest number of incidents with 8 incidents, while Saturday recorded the lowest with 1 incident.',
    );
    expect(kpis).toEqual([
      { label: 'Total Incidents', value: 29, cls: 'accent' },
      { label: 'Busiest Day(s)', value: 'Friday (8)', cls: 'danger' },
      { label: 'Quietest Day(s)', value: 'Saturday (1)', cls: 'success' },
      { label: 'Daily Average', value: 4.1, cls: 'info' },
    ]);
  });

  it('names every tied day and says "each" on both ends of the week', () => {
    // Ties are common at barangay volumes; reporting only the first tied day
    // would understate which days need patrol cover.
    const { insight, kpis } = buildDailyPatternInsight(
      DAY_NAMES,
      [5, 5, 2, 2, 3, 3, 4],
    );
    expect(insight).toBe(
      'Sunday and Monday recorded the highest number of incidents with 5 incidents each, while Tuesday and Wednesday recorded the lowest with 2 incidents each.',
    );
    expect(kpis[1].value).toBe('Sunday and Monday (5)');
    expect(kpis[2].value).toBe('Tuesday and Wednesday (2)');
  });

  it('joins three or more tied days with commas and a final "and"', () => {
    const { insight } = buildDailyPatternInsight(
      DAY_NAMES,
      [2, 4, 4, 4, 3, 3, 1],
    );
    expect(insight).toBe(
      'Monday, Tuesday and Wednesday recorded the highest number of incidents with 4 incidents each, while Saturday recorded the lowest with 1 incident.',
    );
  });

  it('keeps "incident" singular for a count of one, tie or not', () => {
    const single = buildDailyPatternInsight(DAY_NAMES, [3, 1, 2, 2, 2, 2, 2]);
    expect(single.insight).toContain('the lowest with 1 incident.');
    expect(single.insight).not.toContain('1 incidents');

    const tied = buildDailyPatternInsight(DAY_NAMES, [3, 1, 1, 2, 2, 2, 2]);
    expect(tied.insight).toContain(
      'Monday and Tuesday recorded the lowest with 1 incident each.',
    );
  });

  it('names the whole week on both ends when every day is equal', () => {
    const { insight, kpis } = buildDailyPatternInsight(
      DAY_NAMES,
      [2, 2, 2, 2, 2, 2, 2],
    );
    expect(insight).toBe(
      'Sunday, Monday, Tuesday, Wednesday, Thursday, Friday and Saturday recorded the highest number of incidents with 2 incidents each, while Sunday, Monday, Tuesday, Wednesday, Thursday, Friday and Saturday recorded the lowest with 2 incidents each.',
    );
    expect(kpis[3].value).toBe(2);
  });

  it('averages over every bucket supplied, including the empty ones', () => {
    // Trends.jsx reuses this for the hour-of-day chart, where most buckets are
    // legitimately zero; the average must divide by all of them, not only by
    // the buckets that recorded something.
    const { kpis } = buildDailyPatternInsight(
      ['00:00', '01:00', '02:00', '03:00'],
      [4, 0, 0, 0],
    );
    expect(kpis[0].value).toBe(4);
    expect(kpis[3].value).toBe(1);
    expect(kpis[2].value).toBe('01:00, 02:00 and 03:00 (0)');
  });
});

describe('buildForecastInsight — latest actual against the moving average', () => {
  it('reports a rising average and an actual above it', () => {
    expect(
      buildForecastInsight(['Jan', 'Feb', 'Mar'], [4, 6, 8], [4, 5, 6]).insight,
    ).toBe(
      'The moving average is trending upward, moving from 4 to 6 incidents over the selected period. The latest period recorded 8 incidents, above its 6-incident moving average.',
    );
  });

  it('reports a falling average and an actual below it', () => {
    expect(buildForecastInsight(['Jan', 'Feb'], [10, 2], [10, 6]).insight).toBe(
      'The moving average is trending downward, moving from 10 to 6 incidents over the selected period. The latest period recorded 2 incidents, below its 6-incident moving average.',
    );
  });

  it('calls an unchanged average steady and a matching actual in line with it', () => {
    expect(buildForecastInsight(['Jan', 'Feb'], [5, 5], [5, 5]).insight).toBe(
      'The moving average is holding steady, moving from 5 to 5 incidents over the selected period. The latest period recorded 5 incidents, in line with its 5-incident moving average.',
    );
  });

  it('rounds the average to one decimal before differencing and comparing', () => {
    // The endpoints are rounded first, so the reported move is the difference
    // between the two printed figures — 5.3 - 4.3 exactly, not 1.0729...
    const { insight } = buildForecastInsight(
      ['Jan', 'Feb'],
      [4, 6],
      [4.26, 5.3329],
    );
    expect(insight).toBe(
      'The moving average is trending upward, moving from 4.3 to 5.3 incidents over the selected period. The latest period recorded 6 incidents, above its 5.3-incident moving average.',
    );
  });

  it('carries no KPI cards, the sentence is the whole output', () => {
    expect(buildForecastInsight(['Jan', 'Feb'], [4, 6], [4, 5]).kpis).toEqual(
      [],
    );
  });
});

describe('buildRegressionInsight — direction, rate and the S10 guard', () => {
  it('refuses to report a trend or forecast below two periods', () => {
    // S10: linearRegression() answers a shorter series with its
    // {slope: 0, intercept: 0} placeholder, which read as a measured flat
    // trend forecasting zero incidents. Insufficiency is reported instead.
    expect(buildRegressionInsight(0, 'Forecast (2026-04)', 0, 1).insight).toBe(
      'Insufficient data for a linear trend: at least two periods are required, and the selected filters produced only one. No trend direction or forecast is reported.',
    );
    expect(buildRegressionInsight(0, undefined, undefined, 0).insight).toBe(
      'Insufficient data for a linear trend: at least two periods are required, and the selected filters produced none. No trend direction or forecast is reported.',
    );
  });

  it('leaves no trend claim or stray undefined in the insufficient sentence', () => {
    const { insight, kpis } = buildRegressionInsight(
      0,
      undefined,
      undefined,
      1,
    );
    expect(insight).not.toMatch(/flat|projected|undefined|NaN/);
    expect(kpis).toEqual([]);
  });

  it('reports direction and per-period rate from two periods upward', () => {
    expect(
      buildRegressionInsight(2.345, 'Forecast (2026-05)', 12, 2).insight,
    ).toBe(
      'The linear trend shows an upward trajectory, changing by approximately 2.35 incidents per period. Based on this trend, Forecast (2026-05) is projected at approximately 12 incidents.',
    );
    expect(
      buildRegressionInsight(-1.5, 'Forecast (2026-05)', 0, 4).insight,
    ).toBe(
      'The linear trend shows a downward trajectory, changing by approximately 1.5 incidents per period. Based on this trend, Forecast (2026-05) is projected at approximately 0 incidents.',
    );
  });

  it('states the rate as a magnitude, with the sign carried by the wording', () => {
    // A downward trend reads "changing by approximately 1.5", never "-1.5";
    // the word "downward" is what carries the direction.
    const { insight } = buildRegressionInsight(-1.5, 'Forecast', 0, 3);
    expect(insight).not.toContain('-1.5');
    expect(insight).toContain('approximately 1.5 incidents per period');
  });

  it('still calls a measured zero slope flat once there are two periods', () => {
    expect(buildRegressionInsight(0, 'Forecast (2026-05)', 6, 2).insight).toBe(
      'The linear trend shows a flat trajectory, changing by approximately 0 incidents per period. Based on this trend, Forecast (2026-05) is projected at approximately 6 incidents.',
    );
  });

  it('carries no KPI cards on the sufficient-data branch either', () => {
    expect(buildRegressionInsight(2, 'Forecast', 9, 5).kpis).toEqual([]);
  });
});
