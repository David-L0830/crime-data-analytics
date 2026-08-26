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

// ===== Data Utilities =====
export function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = typeof key === 'function' ? key(item) : item[key];
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
