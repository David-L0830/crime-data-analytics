import ChartPrintSummary from '../components/charts/ChartPrintSummary';
import MetabaseDashboard from '../components/MetabaseDashboard';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../hooks/useData';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import FilterBar from '../components/ui/FilterBar';
import KpiCard from '../components/ui/KpiCard';
import Table from '../components/ui/Table';
import ChartCard from '../components/charts/ChartCard';
import ChartSummaryModal from '../components/charts/ChartSummaryModal';
import Button from '../components/ui/Button';
import PrintReport from '../components/ui/PrintReport';
import {
  filterRecords,
  countBy,
  formatDate,
  exportCSV,
  today,
  monthLabelToRange,
  SOLVED_STATUSES,
  PENDING_STATUSES,
} from '../utils/helpers';
import {
  buildCrimeTrendInsight,
  buildCategoryInsight,
  buildSitioInsight,
  buildCrimeTypeInsight,
  buildResolutionInsight,
  buildStatusInsight,
} from '../utils/chartInsights';
import { COLORS } from '../utils/constants';
import { Icons } from '../components/icons';

export default function Dashboard() {
  const {
    records,
    settings,
    SITIOS,
    CRIME_TYPES,
    CATEGORIES,
    STATUSES,
    getTodayImportedCount,
    getThisMonthImportedCount,
  } = useData();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({});
  const [selectedChart, setSelectedChart] = useState(null);

  const filtered = useMemo(
    () =>
      filterRecords(
        records.filter((r) => r.status !== 'Archived'),
        {
          // Restored FROM/TO range filtering (matches Records/Mapping/Analytics/
          // Trends). filterRecords compares r.date ('YYYY-MM-DD' string, no Date
          // object / timezone conversion involved) against dateFrom/dateTo with
          // plain string comparison — inclusive on both ends, so selecting TO
          // includes every incident on that date, and leaving either field
          // blank leaves that bound undefined (no accidental empty dataset).
          dateFrom: filters['dash-dateFrom'],
          dateTo: filters['dash-dateTo'],
          crimeType: filters['dash-crimeType'],
          category: filters['dash-category'],
          sitio: filters['dash-sitio'],
          status: filters['dash-status'],
        },
      ),
    [records, filters],
  );

  const total = filtered.length;
  const solved = filtered.filter((r) =>
    SOLVED_STATUSES.includes(r.status),
  ).length;
  const unsolved = filtered.filter((r) =>
    PENDING_STATUSES.includes(r.status),
  ).length;
  const active = filtered.filter(
    (r) => r.status === 'Under Investigation',
  ).length;
  const resolution = total ? ((solved / total) * 100).toFixed(1) : 0;
  const crimeRate = settings.population
    ? ((total / settings.population) * 1000).toFixed(2)
    : 0;
  const todayCount = filtered.filter((r) => r.date === today()).length;
  const monthCount = filtered.filter((r) =>
    r.date.startsWith(today().slice(0, 7)),
  ).length;

  // Checkpoint 26 — human-readable description of the currently-applied
  // date range, used in the KPI hover hints below so hovering a card tells
  // you exactly which records it's counting.
  // Phase 7 — human-readable summary of every active Dashboard filter, for
  // the chart summary's printed/PDF output ("Active filters" line in the
  // spec). Only lists filters that are actually set, in the same order
  // they appear on the FilterBar.

  const rangeLabel = (() => {
    const from = filters['dash-dateFrom'];
    const to = filters['dash-dateTo'];
    if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
    if (from) return `on or after ${formatDate(from)}`;
    if (to) return `on or before ${formatDate(to)}`;
    return 'all recorded dates';
  })();

  const activeFiltersLabel = (() => {
    const parts = [];
    if (filters['dash-dateFrom'] || filters['dash-dateTo'])
      parts.push(`Date: ${rangeLabel}`);
    if (filters['dash-crimeType'])
      parts.push(`Crime Type: ${filters['dash-crimeType']}`);
    if (filters['dash-category'])
      parts.push(`Category: ${filters['dash-category']}`);
    if (filters['dash-sitio']) parts.push(`Sitio: ${filters['dash-sitio']}`);
    if (filters['dash-status']) parts.push(`Status: ${filters['dash-status']}`);
    return parts.length ? parts.join(' | ') : 'None applied';
  })();

  const baseFilters = {
    crimeType: filters['dash-crimeType'],
    category: filters['dash-category'],
    sitio: filters['dash-sitio'],
    status: filters['dash-status'],
    dateFrom: filters['dash-dateFrom'],
    dateTo: filters['dash-dateTo'],
  };

  const monthStart = `${today().slice(0, 7)}-01`;

  const allKpis = [
    {
      label: 'Total Incidents',
      value: total,
      cls: 'accent',
      hint: `All non-archived incidents for ${rangeLabel}.`,
      to: '/incident-feed',
      state: { filters: baseFilters },
    },
    {
      label: 'Solved Cases',
      value: solved,
      cls: 'success',
      hint: `Incidents marked Solved or Closed for ${rangeLabel}.`,
      to: '/incident-feed',
      state: { filters: baseFilters, statusGroup: 'solved' },
    },
    {
      label: 'Pending Cases',
      value: unsolved,
      cls: 'danger',
      hint: `Incidents marked Open or Under Investigation for ${rangeLabel}.`,
      to: '/incident-feed',
      state: { filters: baseFilters, statusGroup: 'pending' },
    },
    {
      label: 'Active Investigations',
      value: active,
      cls: 'warning',
      to: '/incident-feed',
      state: { filters: { ...baseFilters, status: 'Under Investigation' } },
    },
    {
      label: 'Resolution Rate',
      value: `${resolution}%`,
      cls: 'success',
      to: '/analytics',
      state: {
        filters: {
          dateFrom: filters['dash-dateFrom'],
          dateTo: filters['dash-dateTo'],
          sitio: filters['dash-sitio'],
        },
      },
    },
    {
      label: 'Crime Rate /1K',
      value: crimeRate,
      cls: 'accent',
      to: '/analytics',
      state: {
        filters: {
          dateFrom: filters['dash-dateFrom'],
          dateTo: filters['dash-dateTo'],
          sitio: filters['dash-sitio'],
        },
      },
    },
    {
      label: "Today's Incidents",
      value: todayCount,
      cls: 'orange',
      to: '/incident-feed',
      state: {
        filters: { ...baseFilters, dateFrom: today(), dateTo: today() },
      },
    },
    {
      label: 'This Month',
      value: monthCount,
      cls: 'info',
      to: '/incident-feed',
      state: {
        filters: { ...baseFilters, dateFrom: monthStart, dateTo: undefined },
      },
    },
    {
      label: 'Today Imported',
      value: getTodayImportedCount(),
      cls: 'accent',
      hint: 'Records received via sync today — tracks sync activity, independent of the date range filter above.',
      to: '/audit-logs',
      state: {
        filters: {
          action: 'SYNC_COMPLETED',
          dateFrom: today(),
          dateTo: today(),
        },
      },
    },
    {
      label: 'Month Imported',
      value: getThisMonthImportedCount(),
      cls: 'info',
      hint: 'Records received via sync this calendar month — tracks sync activity, independent of the date range filter above.',
      to: '/audit-logs',
      state: {
        filters: {
          action: 'SYNC_COMPLETED',
          dateFrom: monthStart,
          dateTo: undefined,
        },
      },
    },
  ];

  // Phase 4 — visual hierarchy split only. Same KPI objects as above (no
  // calculation, label, or data change) — just grouped into a primary row
  // (headline stats) and a secondary row (supporting stats) for layout.
  const PRIMARY_KPI_LABELS = [
    'Total Incidents',
    'Solved Cases',
    'Pending Cases',
    'Resolution Rate',
  ];
  const primaryKpis = allKpis.filter((k) =>
    PRIMARY_KPI_LABELS.includes(k.label),
  );
  const secondaryKpis = allKpis.filter(
    (k) => !PRIMARY_KPI_LABELS.includes(k.label),
  );

  // ===== Charts =====
  const monthly = countBy(filtered, (r) => r.date.slice(0, 7));
  const months = Object.keys(monthly).sort();

  const byCat = countBy(filtered, 'category');
  const bySitio = countBy(filtered, 'sitio');
  const sitiosSorted = Object.entries(bySitio).sort((a, b) => b[1] - a[1]);
  const byType = countBy(filtered, 'crimeType');
  const typesSorted = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const resolutionByMonth = months.map((m) => {
    const mr = filtered.filter((r) => r.date.startsWith(m));
    const s = mr.filter((r) => ['Solved', 'Closed'].includes(r.status)).length;
    return mr.length ? +((s / mr.length) * 100).toFixed(1) : 0;
  });
  const byStatus = countBy(filtered, 'status');

  // Phase 3 — same buildXInsight calls that already run inside each
  // ChartCard's onOpenSummary below, just computed once here instead of
  // inside the click handler. This lets the exact same insight/kpis feed
  // both the on-screen "View summary" modal (unchanged) AND the new
  // print-only ChartPrintSummary blocks rendered next to each chart.
  const crimeTrendValues = months.map((m) => monthly[m]);
  const crimeTrendResult = buildCrimeTrendInsight(months, crimeTrendValues);

  const categoryLabels = Object.keys(byCat);
  const categoryValues = Object.values(byCat);
  const categoryResult = buildCategoryInsight(categoryLabels, categoryValues);

  const sitioLabels = sitiosSorted.map((s) => s[0]);
  const sitioValues = sitiosSorted.map((s) => s[1]);
  const sitioResult = buildSitioInsight(sitioLabels, sitioValues);

  const crimeTypeLabels = typesSorted.map((t) => t[0]);
  const crimeTypeValues = typesSorted.map((t) => t[1]);
  const crimeTypeResult = buildCrimeTypeInsight(
    crimeTypeLabels,
    crimeTypeValues,
  );

  const resolutionResult = buildResolutionInsight(months, resolutionByMonth);

  const statusLabels = Object.keys(byStatus);
  const statusValues = Object.values(byStatus);
  const statusResult = buildStatusInsight(statusLabels, statusValues);

  // ===== Tables =====
  const recent = [...filtered]
    .sort(
      // `time` is nullable on purpose — incident_time is nullable in the
      // migration and the Time field is optional in IncidentModal, so
      // IncidentResource legitimately returns time: null. Calling
      // .localeCompare on null throws a TypeError during render, and with no
      // ErrorBoundary above this page that white-screens the whole app rather
      // than breaking one card. Coercing to '' keeps the ordering intact and
      // sorts a missing time last within its own date. `date` needs no such
      // guard: incident_date is NOT NULL in the schema and required by both
      // StoreIncidentRequest and UpdateIncidentRequest.
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.time || '').localeCompare(a.time || ''),
    )
    .slice(0, 8);
  // Group by STREET, not by exact address. `street` is stored house-number
  // first ("116 Tupas St."), and in practice every incident has a different
  // number, so keying on the raw value put every incident in its own group and
  // the table could only ever show a column of 1s — never an actual hotspot.
  // Stripping the leading house number groups the whole street together. No
  // street name spans more than one sitio, so the Sitio column stays coherent.
  // `street` is nullable in the schema, hence the `|| ''` guard before replace.
  const locCounts = countBy(
    filtered,
    (r) => `${r.sitio}|${(r.street || '').replace(/^\s*\d+[A-Za-z]?\s+/, '')}`,
  );
  const hotspots = Object.entries(locCounts)
    // Alphabetical tie-break so equal counts render in a stable, predictable
    // order instead of whatever order the records happened to arrive in.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([k, count]) => {
      const [sitio, location] = k.split('|');
      return { location, sitio, count };
    });
  const suspectCounts = countBy(
    filtered.filter((r) => r.suspectName),
    'suspectName',
  );
  const repeat = Object.entries(suspectCounts)
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));
  const synced = [...filtered]
    .filter((r) => r.synced_at)
    .sort((a, b) => new Date(b.synced_at) - new Date(a.synced_at))
    .slice(0, 5);

  return (
    <section className="module">
      <PrintReport title="Crime Reporting Dashboard Report" />
      <div className="dashboard-welcome">
        <h2>
          Welcome back, <span>{currentUser?.fullName}</span>
        </h2>
        <p>
          Barangay 178 Crime Data Analytics &amp; Reporting System — North
          Caloocan
        </p>
      </div>

      <FilterBar
        fields={[
          { id: 'dash-dateFrom', label: 'From', type: 'date' },
          { id: 'dash-dateTo', label: 'To', type: 'date' },
          {
            id: 'dash-crimeType',
            label: 'Crime Type',
            type: 'select',
            options: CRIME_TYPES,
          },
          {
            id: 'dash-category',
            label: 'Category',
            type: 'select',
            options: CATEGORIES,
          },
          { id: 'dash-sitio', label: 'Sitio', type: 'select', options: SITIOS },
          {
            id: 'dash-status',
            label: 'Status',
            type: 'select',
            options: STATUSES,
          },
        ]}
        onApply={setFilters}
      />

      {/* Print-only summary of the filters in effect when Export PDF was
          used, so the exported document is self-describing — same pattern
          as Trends.jsx. Hidden on screen via .print-only, shown only
          under @media print. */}
      <div
        className="print-only"
        style={{ marginBottom: 14, fontSize: '0.82rem' }}
      >
        <strong>Filters applied:</strong> From:{' '}
        {filters['dash-dateFrom'] || 'Any'} · To:{' '}
        {filters['dash-dateTo'] || 'Any'} · Crime Type:{' '}
        {filters['dash-crimeType'] || 'All'} · Category:{' '}
        {filters['dash-category'] || 'All'} · Sitio:{' '}
        {filters['dash-sitio'] || 'All'} · Status:{' '}
        {filters['dash-status'] || 'All'}
      </div>

      <div className="dashboard-kpi-section">
        <div className="kpi-grid kpi-grid-primary">
          {primaryKpis.map((k) => (
            <KpiCard key={k.label} {...k} />
          ))}
        </div>

        <div className="kpi-secondary-label">Additional Statistics</div>
        <div className="kpi-grid kpi-grid-secondary">
          {secondaryKpis.map((k) => (
            <KpiCard key={k.label} {...k} />
          ))}
        </div>
      </div>

      <MetabaseDashboard
        dashboardKey="crime"
        filters={baseFilters}
        title="Crime Dashboard"
        height={2400}
      />

      <ChartSummaryModal
        open={!!selectedChart}
        onClose={() => setSelectedChart(null)}
        activeFiltersLabel={activeFiltersLabel}
        {...selectedChart}
        onDrillDown={
          selectedChart?.drillField
            ? (label) => {
                const drillFilters = { ...baseFilters };
                if (selectedChart.drillField === 'month') {
                  const { dateFrom, dateTo } = monthLabelToRange(label);
                  drillFilters.dateFrom = dateFrom;
                  drillFilters.dateTo = dateTo;
                } else if (selectedChart.drillField === 'category') {
                  drillFilters.category = label;
                } else if (selectedChart.drillField === 'sitio') {
                  drillFilters.sitio = label;
                } else if (selectedChart.drillField === 'crimeType') {
                  drillFilters.crimeType = label;
                } else if (selectedChart.drillField === 'status') {
                  drillFilters.status = label;
                }
                setSelectedChart(null);
                navigate('/incident-feed', {
                  state: { filters: drillFilters },
                });
              }
            : undefined
        }
      />

      <div className="table-grid dashboard-lower-grid">
        <div className="card">
          <h3>Recent Incidents</h3>
          <div className="table-wrap">
            <Table
              columns={[
                { key: 'caseNumber', label: 'Case #' },
                { key: 'crimeType', label: 'Type' },
                { key: 'date', label: 'Date', render: formatDate },
                { key: 'sitio', label: 'Sitio' },
                { key: 'status', label: 'Status' },
              ]}
              rows={recent}
            />
          </div>
        </div>
        <div className="card">
          <h3>Hotspot Locations</h3>
          <div className="table-wrap">
            <Table
              columns={[
                { key: 'location', label: 'Location' },
                { key: 'sitio', label: 'Sitio' },
                { key: 'count', label: 'Incidents' },
              ]}
              rows={hotspots}
            />
          </div>
        </div>
        <div className="card">
          <h3>Repeat Offenders</h3>
          <div className="table-wrap">
            <Table
              columns={[
                { key: 'name', label: 'Suspect' },
                { key: 'count', label: 'Incidents' },
              ]}
              rows={repeat}
            />
          </div>
        </div>
        <div className="card">
          <h3>Recently Synchronized</h3>
          <div className="table-wrap">
            <Table
              columns={[
                { key: 'caseNumber', label: 'Case #' },
                { key: 'crimeType', label: 'Type' },
                { key: 'date', label: 'Date', render: formatDate },
                {
                  key: 'synced_at',
                  label: 'Synced',
                  render: (v) =>
                    v ? new Date(v).toLocaleString('en-PH') : '—',
                },
              ]}
              rows={synced}
            />
          </div>
        </div>
      </div>

      <div className="export-bar">
        <Button
          variant="secondary"
          onClick={() => {
            window.print();
            showToast('Use browser print dialog to save as PDF', 'info');
          }}
        >
          <Icons.Report size={15} strokeWidth={2} /> Export PDF
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            if (
              exportCSV(filtered, `brgy178_dashboard_${today()}.csv`, () =>
                showToast('No data to export', 'error'),
              )
            )
              showToast('Dashboard data exported', 'success');
          }}
        >
          <Icons.Download size={15} strokeWidth={2} /> Export Excel
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          <Icons.Printer size={15} strokeWidth={2} /> Print Report
        </Button>
      </div>
    </section>
  );
}
