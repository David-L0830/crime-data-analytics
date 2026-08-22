// Chart-specific analytical logic (Phase 3). Each function takes the same
// `labels`/`values` arrays already computed for that chart on the Dashboard
// and returns { insight, kpis } — a plain sentence plus a KpiCard-ready
// array. Nothing here is hard-coded: every number is derived from the
// arrays passed in, so results always reflect whatever dashboard filters
// are currently applied.

function pct(part, total) {
  return total ? +((part / total) * 100).toFixed(1) : 0;
}

function rankEntries(labels, values) {
  const total = values.reduce((a, b) => a + b, 0);
  const entries = labels.map((label, i) => ({ label, value: values[i] ?? 0 }));
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const top = sorted[0] ?? { label: '—', value: 0 };
  const bottom = sorted[sorted.length - 1] ?? { label: '—', value: 0 };
  return { total, sorted, top, bottom };
}

// Crime Trend (Monthly) — counts per month. Also reused for Weekly Trends
// on the Trends page (Phase 4), passing unitLabel='Week' — the logic
// (peak/latest/average/change over an ordered time series) is identical
// for weeks, only the labels differ. Existing calls with 2 arguments (e.g.
// Dashboard.jsx's Crime Trend chart) are unaffected — unitLabel defaults
// to 'Month', producing byte-for-byte the same output as before.
export function buildCrimeTrendInsight(labels, values, unitLabel = 'Month') {
  if (!values.length) return { insight: 'No incident data available for the selected range.', kpis: [] };

  const total = values.reduce((a, b) => a + b, 0);
  const highestIdx = values.indexOf(Math.max(...values));
  const lowestIdx = values.indexOf(Math.min(...values));
  const average = +(total / values.length).toFixed(1);
  const first = values[0];
  const latest = values[values.length - 1];
  const peak = values[highestIdx];
  const peakLabel = labels[highestIdx];
  const changeFromFirst = latest - first;
  const pctChangeFromFirst = first ? +((changeFromFirst / first) * 100).toFixed(1) : (latest > 0 ? 100 : 0);
  const pctChangeFromPeak = peak ? +(((peak - latest) / peak) * 100).toFixed(1) : 0;
  const direction = latest >= peak ? 'increase' : 'decrease';

  const insight = `Incident volume peaked in ${peakLabel} with ${peak} recorded incidents, while the latest period recorded ${latest} incidents, representing a ${pctChangeFromPeak}% ${direction} from the peak.`;

  const kpis = [
    { label: 'Total Incidents', value: total, cls: 'accent' },
    { label: `Highest ${unitLabel}`, value: `${peakLabel} (${peak})`, cls: 'danger' },
    { label: `Lowest ${unitLabel}`, value: `${labels[lowestIdx]} (${values[lowestIdx]})`, cls: 'success' },
    { label: `${unitLabel}ly Average`, value: average, cls: 'info' },
    { label: 'Change (First → Latest)', value: `${changeFromFirst >= 0 ? '+' : ''}${changeFromFirst} (${pctChangeFromFirst >= 0 ? '+' : ''}${pctChangeFromFirst}%)`, cls: changeFromFirst > 0 ? 'danger' : 'success' },
  ];

  return { insight, kpis };
}

// Crimes by Category.
export function buildCategoryInsight(labels, values) {
  const { total, top, bottom, sorted } = rankEntries(labels, values);
  if (!sorted.length) return { insight: 'No category data available for the selected range.', kpis: [] };
  const topPct = pct(top.value, total);

  const insight = `${top.label} is the leading category with ${top.value} incidents, representing ${topPct}% of all recorded incidents.`;

  const kpis = [
    { label: 'Total Incidents', value: total, cls: 'accent' },
    { label: 'Leading Category', value: `${top.label} (${top.value})`, cls: 'danger' },
    { label: 'Leading Share', value: `${topPct}%`, cls: 'warning' },
    { label: 'Lowest Category', value: `${bottom.label} (${bottom.value})`, cls: 'success' },
    { label: 'Categories Recorded', value: sorted.length, cls: 'info' },
  ];

  return { insight, kpis };
}

// Crimes by Sitio.
export function buildSitioInsight(labels, values) {
  const { total, top, bottom, sorted } = rankEntries(labels, values);
  if (!sorted.length) return { insight: 'No sitio data available for the selected range.', kpis: [] };
  const topPct = pct(top.value, total);

  const insight = `${top.label} has the highest recorded incident volume with ${top.value} incidents, representing ${topPct}% of all incidents.`;

  const kpis = [
    { label: 'Total Incidents', value: total, cls: 'accent' },
    { label: 'Highest Sitio', value: `${top.label} (${top.value})`, cls: 'danger' },
    { label: 'Highest Share', value: `${topPct}%`, cls: 'warning' },
    { label: 'Lowest Sitio', value: `${bottom.label} (${bottom.value})`, cls: 'success' },
    { label: 'Sitios Recorded', value: sorted.length, cls: 'info' },
  ];

  return { insight, kpis };
}

// Top Crime Types.
export function buildCrimeTypeInsight(labels, values) {
  const { total, top, bottom, sorted } = rankEntries(labels, values);
  if (!sorted.length) return { insight: 'No crime type data available for the selected range.', kpis: [] };
  const topPct = pct(top.value, total);

  const insight = `${top.label} is the most common crime type with ${top.value} incidents, representing ${topPct}% of all recorded incidents.`;

  const kpis = [
    { label: 'Total Incidents', value: total, cls: 'accent' },
    { label: 'Most Common', value: `${top.label} (${top.value})`, cls: 'danger' },
    { label: 'Leading Share', value: `${topPct}%`, cls: 'warning' },
    { label: 'Least Common', value: `${bottom.label} (${bottom.value})`, cls: 'success' },
    { label: 'Crime Types Recorded', value: sorted.length, cls: 'info' },
  ];

  return { insight, kpis };
}

// Resolution Rate Trend — values here are already percentages, not counts.
export function buildResolutionInsight(labels, values) {
  if (!values.length) return { insight: 'No resolution rate data available for the selected range.', kpis: [] };

  const highest = Math.max(...values);
  const lowest = Math.min(...values);
  const highestIdx = values.indexOf(highest);
  const lowestIdx = values.indexOf(lowest);
  const average = +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
  const first = values[0];
  const latest = values[values.length - 1];
  const change = +(latest - first).toFixed(1);
  const direction = change >= 0 ? 'improved' : 'declined';

  const insight = `Case resolution has ${direction} from ${first}% to ${latest}% across the selected period, a change of ${change >= 0 ? '+' : ''}${change} percentage points. The rate peaked at ${highest}% in ${labels[highestIdx]} and dipped to a low of ${lowest}% in ${labels[lowestIdx]}.`;

  const kpis = [
    { label: 'Latest Resolution Rate', value: `${latest}%`, cls: latest >= average ? 'success' : 'warning' },
    { label: 'Highest Rate', value: `${highest}% (${labels[highestIdx]})`, cls: 'success' },
    { label: 'Lowest Rate', value: `${lowest}% (${labels[lowestIdx]})`, cls: 'danger' },
    { label: 'Average Rate', value: `${average}%`, cls: 'info' },
    { label: 'Change (First → Latest)', value: `${change >= 0 ? '+' : ''}${change} pts`, cls: change >= 0 ? 'success' : 'danger' },
  ];

  return { insight, kpis };
}

// Incident Status Distribution.
export function buildStatusInsight(labels, values) {
  const total = values.reduce((a, b) => a + b, 0);
  if (!total) return { insight: 'No status data available for the selected range.', kpis: [] };

  const byStatus = Object.fromEntries(labels.map((label, i) => [label, values[i] ?? 0]));
  const openCount = byStatus['Open'] ?? 0;
  const investigatingCount = byStatus['Under Investigation'] ?? 0;
  const solvedCount = byStatus['Solved'] ?? 0;
  const closedCount = byStatus['Closed'] ?? 0;
  const unresolvedCount = openCount + investigatingCount;
  const resolvedCount = solvedCount + closedCount;
  const openPct = pct(openCount, total);
  const unresolvedPct = pct(unresolvedCount, total);
  const resolvedPct = pct(resolvedCount, total);

  const insight = openCount > 0
    ? `Open cases represent ${openPct}% of recorded incidents, indicating that a significant portion of cases remains unresolved.`
    : `${unresolvedPct}% of recorded incidents remain unresolved (Open or Under Investigation).`;

  const kpis = [
    { label: 'Total Incidents', value: total, cls: 'accent' },
    { label: 'Open', value: openCount, cls: 'danger' },
    { label: 'Under Investigation', value: investigatingCount, cls: 'warning' },
    { label: 'Solved / Closed', value: resolvedCount, cls: 'success' },
    { label: 'Unresolved Share', value: `${unresolvedPct}%`, cls: 'danger' },
    { label: 'Resolved Share', value: `${resolvedPct}%`, cls: 'success' },
  ];

  return { insight, kpis };
}

// Daily Trends (Trend and Pattern Detection) — incident counts per day of
// the week (Sun..Sat). Unlike buildCrimeTrendInsight above, these are
// categorical buckets, not an ordered time series, so this reports the
// busiest/quietest day(s) instead of a first→latest change — and calls
// out ties explicitly (e.g. two days sharing the lowest count), which is
// common with smaller datasets.
export function buildDailyPatternInsight(labels, values) {
  const total = values.reduce((a, b) => a + b, 0);
  if (!total) return { insight: 'No incident data available for the selected range.', kpis: [] };

  const max = Math.max(...values);
  const min = Math.min(...values);
  const average = +(total / values.length).toFixed(1);
  const highDays = labels.filter((_, i) => values[i] === max);
  const lowDays = labels.filter((_, i) => values[i] === min);
  const joinDays = (days) => (days.length > 1
    ? `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`
    : days[0]);

  const insight = `${joinDays(highDays)} recorded the highest number of incidents with ${max} incident${max === 1 ? '' : 's'}${highDays.length > 1 ? ' each' : ''}, while ${joinDays(lowDays)} recorded the lowest with ${min} incident${min === 1 ? '' : 's'}${lowDays.length > 1 ? ' each' : ''}.`;

  const kpis = [
    { label: 'Total Incidents', value: total, cls: 'accent' },
    { label: 'Busiest Day(s)', value: `${joinDays(highDays)} (${max})`, cls: 'danger' },
    { label: 'Quietest Day(s)', value: `${joinDays(lowDays)} (${min})`, cls: 'success' },
    { label: 'Daily Average', value: average, cls: 'info' },
  ];

  return { insight, kpis };
}

// Forecast (Moving Avg) — Trend and Pattern Detection. Compares the
// latest actual value against the moving average and reports the
// average's own direction across the selected period. Takes the exact
// `counts`/`ma` arrays already computed on the Trends page.
export function buildForecastInsight(labels, actual, movingAvg) {
  if (!actual.length) return { insight: 'No incident data available for the selected range.', kpis: [] };

  const latestActual = actual[actual.length - 1];
  const latestAvg = +movingAvg[movingAvg.length - 1].toFixed(1);
  const firstAvg = +movingAvg[0].toFixed(1);
  const avgChange = +(latestAvg - firstAvg).toFixed(1);
  const direction = avgChange > 0 ? 'trending upward' : avgChange < 0 ? 'trending downward' : 'holding steady';
  const relation = latestActual > latestAvg ? 'above' : latestActual < latestAvg ? 'below' : 'in line with';

  const insight = `The moving average is ${direction}, moving from ${firstAvg} to ${latestAvg} incidents over the selected period. The latest period recorded ${latestActual} incidents, ${relation} its ${latestAvg}-incident moving average.`;

  return { insight, kpis: [] };
}

// Linear Regression — Trend and Pattern Detection. Reports the trend's
// direction/rate from the already-computed `slope`, and the forecasted
// value for the next period the Trends page already calculates.
export function buildRegressionInsight(slope, forecastLabel, forecastValue) {
  const direction = slope > 0 ? 'an upward' : slope < 0 ? 'a downward' : 'a flat';
  const perPeriod = Math.abs(+slope.toFixed(2));

  const insight = `The linear trend shows ${direction} trajectory, changing by approximately ${perPeriod} incidents per period. Based on this trend, ${forecastLabel} is projected at approximately ${forecastValue} incidents.`;

  return { insight, kpis: [] };
}