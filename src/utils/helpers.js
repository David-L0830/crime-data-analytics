// Shared helper functions used across pages — formatting, basic statistics, and CSV export.
// Pure functions only; no DOM access, so they're safe to unit test later.

export function formatDate(d) {
  if (!d || d === '—') return '—';
  const parsed = new Date(d + 'T00:00:00');
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatTime(t) {
  if (!t) return '—';
  const parts = t.split(':');
  if (parts.length < 2) return t;
  const h = parseInt(parts[0], 10);
  const m = parts[1];
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

// Barangay 178 works in Philippine calendar dates, so "today" must be the
// Manila date. toISOString() returns the UTC date, which for UTC+8 is still
// YESTERDAY between 00:00 and 08:00 PH — that made Today's Incidents (and, on
// the 1st of a month, This Month and monthStart) count the wrong day every
// morning. en-CA with explicit 2-digit parts yields the same 'YYYY-MM-DD'
// shape the rest of the app compares against, since a record's `date` is a
// plain 'YYYY-MM-DD' string from the API (see IncidentResource) and every
// comparison here is a string comparison, never a Date object.
export function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
// Converts a 'YYYY-MM' label (as produced by Dashboard's monthly grouping)
// into an inclusive { dateFrom, dateTo } range for filtering records.
export function monthLabelToRange(monthLabel) {
  if (!monthLabel || !/^\d{4}-\d{2}$/.test(monthLabel))
    return { dateFrom: undefined, dateTo: undefined };
  const [year, month] = monthLabel.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate(); // day 0 of next month = last day of this month
  return {
    dateFrom: `${monthLabel}-01`,
    dateTo: `${monthLabel}-${String(lastDay).padStart(2, '0')}`,
  };
}

// The month axis for a time series, made continuous: every month from the
// first present one to the last, including those with no records at all.
//
// Trends and Dashboard used to build the axis from whatever keys countBy
// happened to produce, and plot them at x = array index. A month with no
// matching incidents produced no key, so the gap silently closed — February and
// May were drawn adjacent and equally spaced, and the regression fitted a line
// through a compressed timeline. On a 2 / 4 / - / - / 6 series that inflated
// the slope fivefold (2.0 against 0.4) and the forecast from 3.6 to 8. The
// filtered views where this happens are ordinary use: pick one crime type or
// one sitio and quiet months disappear.
//
// INTERIOR GAPS ONLY. The axis spans the data, not the filter: a Jan-Dec filter
// over records that only exist in March does not produce nine empty months.
//
// Returns keys only, and never fabricates counts — the caller reads an absent
// month as zero. The input object is not mutated. The month count is computed
// arithmetically rather than by incrementing until a sentinel matches, so a
// malformed key cannot spin this into an infinite loop in the browser.
export function continuousMonths(monthCounts) {
  const present = Object.keys(monthCounts).sort();
  if (present.length < 2) return present;

  const [firstYear, firstMonth] = present[0].split('-').map(Number);
  const [lastYear, lastMonth] = present[present.length - 1]
    .split('-')
    .map(Number);

  const span = (lastYear - firstYear) * 12 + (lastMonth - firstMonth);
  if (!Number.isFinite(span) || span < 0) return present;

  return Array.from({ length: span + 1 }, (_, i) => {
    const monthsFromYearZero = firstMonth - 1 + i;
    const year = firstYear + Math.floor(monthsFromYearZero / 12);
    const month = (monthsFromYearZero % 12) + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
  });
}

// Relative age of a notification, for the bell's dropdown ("2 minutes ago").
//
// A notification's value is mostly "how recently did this happen", and an
// absolute "8/28/2026, 1:07:39 AM" makes the reader do that subtraction
// themselves. Absolute time is still available: the panel puts it in the
// entry's `title`, so hovering gives the exact moment.
//
// Intl.RelativeTimeFormat is used rather than a date library — it is built into
// every browser this app supports, so this costs nothing to ship and localises
// itself. Anything older than a week falls back to a plain date, because
// "37 days ago" is harder to place than the date itself.
export function relativeTime(value) {
  if (!value) return '';

  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return '';

  const seconds = Math.round((Date.now() - then.getTime()) / 1000);

  // A clock skew between the browser and the server can put a just-created
  // notification a few seconds in the FUTURE. "in 4 seconds" would be absurd,
  // so anything within a minute either way reads as "Just now".
  if (seconds < 60) return 'Just now';

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, 'minute');

  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');

  const days = Math.round(hours / 24);
  if (days < 7) return rtf.format(-days, 'day');

  return then.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function uid(prefix = 'UID') {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// ===== Statistics =====
export function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mode(arr) {
  if (!arr.length) return null;
  const freq = {};
  arr.forEach((v) => {
    freq[v] = (freq[v] || 0) + 1;
  });
  let max = 0;
  let modeVal = arr[0];
  for (const [k, v] of Object.entries(freq)) {
    if (v > max) {
      max = v;
      modeVal = k;
    }
  }
  return modeVal;
}

export function variance(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
}

export function stdDev(arr) {
  return Math.sqrt(variance(arr));
}

export function linearRegression(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: 0 };
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0;
  points.forEach(([x, y]) => {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  });
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export function movingAverage(data, window = 3) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = data.slice(start, i + 1);
    result.push(mean(slice));
  }
  return result;
}

// The regression line evaluated one step past the end of the data — the value
// Trends reports as next month's Forecast.
//
// Clamped at zero because a sufficiently declining series drives the
// extrapolation below it, and "-1 incidents next month" is not a pessimistic
// estimate, it is an impossible one — and it goes into a printed barangay
// report. Zero is the honest floor: the fewest crimes that can occur is none.
//
// Only this extrapolated point is clamped. The historical fitted values Trends
// draws are left exactly as linearRegression() produced them, because they
// describe a line through data that actually happened and flattening them at
// zero would misrepresent the fit. linearRegression() itself is unchanged.
//
// Lives here rather than in Trends.jsx so the clamp is unit-testable without
// importing a React page, and so a component file does not export a
// non-component (which react-refresh warns about).
export function forecastNext(slope, intercept, n) {
  return Math.max(0, +(slope * n + intercept).toFixed(1));
}

// The incident count at which a sitio's severity reaches High. This was a bare
// 5 inside Trends, alongside a bare 3 that the configurable Hotspot Alert
// Threshold has now replaced. It stays a constant rather than becoming a second
// setting: nothing in the repository ever documented it — git log on the
// literal reaches only the initial commit, no comment or doc relates it to the
// hotspot threshold, and the design spec the code cites ("Part F-19") is not in
// the repository — so promoting it to a named default is the most it can honestly
// become without inventing a meaning for it.
const HOTSPOT_HIGH_BOUNDARY = 5;

// The severity band for a sitio, given its incident count and the configured
// Hotspot Alert Threshold.
//
// The threshold decides what counts as a hotspot at all: docs/API_ENDPOINTS.md
// defines it as the count a sitio "meets or exceeds" to qualify, which is why
// every comparison here is >=. Before this, the setting was editable, validated
// and persisted, and then read by nothing — Trends classified with hard-coded
// literals, so moving the setting from 1 to 99 changed nothing anyone could see.
//
//   Low     count <  threshold          not a hotspot
//   Medium  count >= threshold          a hotspot, below the High boundary
//   High    count >= max(5, threshold)
//
// The max() is what keeps the two bands coherent. With a threshold above 5 a
// bare `count >= 5` would label a sitio High while it sat BELOW the configured
// threshold — worst severity for somewhere that does not qualify as a hotspot
// at all, printed in a barangay report. Above 5 the two boundaries coincide and
// Medium is empty, which is a real consequence of the rule rather than an
// oversight: once the threshold is that strict, qualifying as a hotspot and
// being severe are the same statement.
//
// A missing threshold falls back to 3, matching normalizeSettings() in
// DataContext and the hotspot_threshold column default. A configured 0 is
// honoured rather than treated as missing, because SettingController validates
// the field as integer min:0, so 0 is a real value a user can choose.
export function hotspotRisk(count, threshold) {
  const configured = Number.isFinite(threshold) ? threshold : 3;
  const highBoundary = Math.max(HOTSPOT_HIGH_BOUNDARY, configured);

  if (count >= highBoundary) return 'High';
  if (count >= configured) return 'Medium';
  return 'Low';
}

// ===== Data Utilities =====
// The bucket a record falls into when the field being grouped by has no
// value. Without this, `acc[k]` with k === null coerces the object key to the
// STRING "null", and that string is what reaches the charts — so a Category
// Distribution pie and the Category × Sitio crosstab would render a slice and
// a row literally labelled "null" in a printed barangay report.
//
// incidents.category is nullable in the schema and 'nullable' in
// StoreIncidentRequest, so an incident saved without a category is a
// legitimate record, not bad data. It just needs an honest label rather than a
// JavaScript coercion artefact. Category is not made required by this.
export const UNCATEGORISED = 'Uncategorised';

export function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const raw = typeof key === 'function' ? key(item) : item[key];
    // Only absent values are rebucketed. Composite keys built by a callback
    // (e.g. `${sitio}|${street}`) are already non-empty strings and are
    // unaffected, and 0 / false are preserved rather than being swallowed by a
    // truthiness check.
    const k =
      raw === null || raw === undefined || raw === '' ? UNCATEGORISED : raw;
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

export function countBy(arr, key) {
  const groups = groupBy(arr, key);
  return Object.fromEntries(
    Object.entries(groups).map(([k, v]) => [k, v.length]),
  );
}

// ===== Filters =====
// Checkpoint 26 — verified date-range filtering (shared by Dashboard,
// Analytics, Trends, IncidentFeed, Mapping — every FROM/TO filter in the
// app funnels through this one function, so a fix here fixes all of them).
// `r.date` and `filters.dateFrom`/`dateTo` are always plain 'YYYY-MM-DD'
// strings (native <input type="date"> values, and incident dates are
// stored/returned the same way — see IncidentResource on the backend) with
// no time-of-day component, so this is a pure lexical string comparison,
// never a `new Date(...)` parse — there is no UTC/local timezone
// conversion for it to accidentally apply. That also makes both ends
// naturally inclusive: '2026-08-14' <= '2026-08-14' is true for FROM, and
// '2026-08-14' <= '2026-08-14' is true for TO, exactly as required (see
// the "records exactly on the FROM/TO date" edge case).

export const SOLVED_STATUSES = ['Solved', 'Closed'];
export const PENDING_STATUSES = ['Open', 'Under Investigation'];

export function filterRecords(records, filters) {
  return records.filter((r) => {
    if (filters.dateFrom && r.date < filters.dateFrom) return false;
    if (filters.dateTo && r.date > filters.dateTo) return false;
    if (filters.crimeType && r.crimeType !== filters.crimeType) return false;
    if (filters.category && r.category !== filters.category) return false;
    if (filters.sitio && r.sitio !== filters.sitio) return false;
    if (filters.officer && r.reportingOfficer !== filters.officer) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay =
        `${r.caseNumber} ${r.street} ${r.reportingOfficer} ${r.crimeType} ${r.sitio || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// Account Administration — renders an ISO-8601 timestamp from the API (e.g.
// UserResource.lastLoginAt / createdAt, AuditLogResource.timestamp) as a
// readable local date and time.
//
// Deliberately separate from formatDate() above rather than an extra branch
// inside it: formatDate takes a plain 'YYYY-MM-DD' string and appends
// 'T00:00:00' to force local-midnight parsing, which would corrupt a value
// that already carries a time and an offset. These are two different inputs,
// so they get two functions.
//
// Returns null — not a placeholder string — when there is no value, so each
// caller can choose the wording the situation actually calls for ("Never" for
// a sign-in that has not happened, "Not available" for data this system does
// not hold). Inventing a date here is exactly the thing this module must not
// do.
export function formatDateTime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// Just the clock portion of an ISO timestamp, for the User Activity timeline
// where the day is already the group heading.
export function formatClockTime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
