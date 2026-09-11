import { describe, expect, it } from 'vitest';
import { buildRegressionInsight } from './chartInsights';
import {
  buildRegressionSeries,
  linearRegression,
  forecastNext,
} from './helpers';

/**
 * S10 — single-period regression forecast on Trend and Pattern Detection.
 *
 * A straight line cannot be fitted to one point. linearRegression() answers a
 * one-point series with its {slope: 0, intercept: 0} placeholder, and the
 * Linear Regression chart consumed that placeholder as if it were a fit: it
 * drew a fitted value of 0 over a month that had incidents, appended a
 * forecast point of 0 for the following month, and the printed analysis
 * sentence called it "a flat trajectory ... projected at approximately 0
 * incidents". None of those numbers were measured from anything; a barangay
 * reading the printed report was told next month is forecast at zero crimes on
 * the strength of a single month of data.
 *
 * The fix reports insufficiency instead of fabricating a fit. These tests pin
 * both halves: that below two periods no forecast and no flat-trend claim is
 * produced, and that at two or more periods the previous arithmetic and the
 * previous wording are unchanged.
 */

describe('S10 — single period produces no regression forecast', () => {
  it('pins the placeholder that made the fabricated forecast possible', () => {
    // Not the fix — the reason the fix is needed. One point cannot determine a
    // line, so linearRegression() returns zeros, and reading a forecast off
    // those zeros yields 0 regardless of how many incidents the month had.
    const { slope, intercept } = linearRegression([[0, 7]]);
    expect({ slope, intercept }).toEqual({ slope: 0, intercept: 0 });
    expect(forecastNext(slope, intercept, 1)).toBe(0);
  });

  it('adds no forecast point or forecast column for one month', () => {
    const r = buildRegressionSeries(['2026-03'], [7]);
    expect(r.hasRegression).toBe(false);
    expect(r.forecast).toEqual([]);
    expect(r.regression).toEqual([]);
    expect(r.regLabels).toEqual(['2026-03']);
    expect(r.regActual).toEqual([7]);
    expect(r.regLabels).toHaveLength(r.regActual.length);
  });

  it('does not report a flat trajectory or a zero forecast for one month', () => {
    const r = buildRegressionSeries(['2026-03'], [7]);
    const { insight } = buildRegressionInsight(
      r.slope,
      r.nextLabel,
      r.forecast[r.forecast.length - 1],
      1,
    );
    expect(insight).toBe(
      'Insufficient data for a linear trend: at least two periods are required, and the selected filters produced only one. No trend direction or forecast is reported.',
    );
    expect(insight).not.toMatch(/flat/);
    expect(insight).not.toMatch(/projected/);
    expect(insight).not.toMatch(/\b0 incidents\b/);
  });

  it('says the same for a single month that recorded no incidents', () => {
    const r = buildRegressionSeries(['2026-03'], [0]);
    expect(r.forecast).toEqual([]);
    expect(
      buildRegressionInsight(r.slope, r.nextLabel, undefined, 1).insight,
    ).toMatch(/^Insufficient data for a linear trend/);
  });

  it('reports insufficiency rather than an undefined forecast for no months', () => {
    const r = buildRegressionSeries([], []);
    expect(r.hasRegression).toBe(false);
    expect(r.forecast).toEqual([]);
    expect(r.regLabels).toEqual([]);
    const { insight } = buildRegressionInsight(
      r.slope,
      r.nextLabel,
      r.forecast[r.forecast.length - 1],
      0,
    );
    expect(insight).toBe(
      'Insufficient data for a linear trend: at least two periods are required, and the selected filters produced none. No trend direction or forecast is reported.',
    );
    expect(insight).not.toMatch(/undefined/);
  });

  it('returns no KPIs, as the sufficient-data branch does', () => {
    expect(buildRegressionInsight(0, 'Forecast', undefined, 1).kpis).toEqual(
      [],
    );
  });
});

describe('S10 — two or more periods are unchanged', () => {
  it('fits, forecasts and labels a two-month series exactly as before', () => {
    const r = buildRegressionSeries(['2026-03', '2026-04'], [4, 8]);
    expect(r.hasRegression).toBe(true);
    expect(r.slope).toBe(4);
    expect(r.intercept).toBe(4);
    expect(r.regression).toEqual([4, 8]);
    expect(r.forecast).toEqual([4, 8, 12]);
    expect(r.regLabels).toEqual(['2026-03', '2026-04', 'Forecast (2026-05)']);
    expect(r.regActual).toEqual([4, 8, null]);
  });

  it('rolls the December forecast label into the following year', () => {
    // The month rolls to 01 and the year now increments with it, so
    // December's forecast column reads "2027-01" rather than "2026-01".
    const r = buildRegressionSeries(['2026-11', '2026-12'], [3, 5]);
    expect(r.nextLabel).toBe('Forecast (2027-01)');
    expect(r.regLabels[2]).toBe('Forecast (2027-01)');
  });

  it('keeps the declining-series clamp at zero', () => {
    const r = buildRegressionSeries(
      ['2026-01', '2026-02', '2026-03'],
      [9, 5, 1],
    );
    expect(r.slope).toBe(-4);
    expect(r.forecast).toEqual([9, 5, 1, 0]);
  });

  it('still describes a genuinely flat two-month series as flat', () => {
    // The insufficiency guard must not swallow a real zero slope: two months
    // that both recorded 6 incidents are a measured flat trend, not missing
    // data, and the sentence is the one it always was.
    const r = buildRegressionSeries(['2026-03', '2026-04'], [6, 6]);
    const { insight } = buildRegressionInsight(
      r.slope,
      r.nextLabel,
      r.forecast[r.forecast.length - 1],
      2,
    );
    expect(insight).toBe(
      'The linear trend shows a flat trajectory, changing by approximately 0 incidents per period. Based on this trend, Forecast (2026-05) is projected at approximately 6 incidents.',
    );
  });

  it('keeps the upward and downward wording and per-period rate', () => {
    expect(
      buildRegressionInsight(2.345, 'Forecast (2026-05)', 12, 3).insight,
    ).toBe(
      'The linear trend shows an upward trajectory, changing by approximately 2.35 incidents per period. Based on this trend, Forecast (2026-05) is projected at approximately 12 incidents.',
    );
    expect(
      buildRegressionInsight(-1.5, 'Forecast (2026-05)', 0, 4).insight,
    ).toBe(
      'The linear trend shows a downward trajectory, changing by approximately 1.5 incidents per period. Based on this trend, Forecast (2026-05) is projected at approximately 0 incidents.',
    );
  });
});

describe('Forecast label year rollover', () => {
  it('rolls December into January of the following year', () => {
    const r = buildRegressionSeries(['2026-11', '2026-12'], [3, 5]);
    expect(r.nextLabel).toBe('Forecast (2027-01)');
  });

  it('keeps the same year for a normal mid-year transition', () => {
    const r = buildRegressionSeries(['2026-05', '2026-06'], [3, 5]);
    expect(r.nextLabel).toBe('Forecast (2026-07)');
  });

  it('keeps the same year rolling from January into February', () => {
    const r = buildRegressionSeries(['2026-01', '2026-02'], [3, 5]);
    expect(r.nextLabel).toBe('Forecast (2026-03)');
  });
});
