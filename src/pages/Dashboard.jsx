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
import PrintReport, { PrintDocumentEnd } from '../components/ui/PrintReport';
import { exportWorkbook } from '../utils/exportWorkbook';
import { exportCsv } from '../utils/exportCsv';
import { auditLogService } from '../services/auditLogService';
import {
  filterRecords,
  countBy,
  formatDate,
  today,
  continuousMonths,
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
  // Two different axes, deliberately.
  //
  // `trendMonths` is continuous — a month with no incidents is a real zero on a
  // crime-count trend, and omitting it compressed the timeline (see
  // continuousMonths()).
  //
  // `months` stays the months actually present, because it also labels the
  // Resolution Rate Trend, and a month with no incidents has no resolution
  // rate. Zero-filling that series would print "0% resolved" for a month in
  // which nothing needed resolving, which is worse than leaving the month out.
  const trendMonths = continuousMonths(monthly);
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
  const crimeTrendValues = trendMonths.map((m) => monthly[m] ?? 0);
  const crimeTrendResult = buildCrimeTrendInsight(
    trendMonths,
    crimeTrendValues,
  );

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
      // .localeCompare on null throws a TypeError during render. The
      // ErrorBoundary in MainLayout now contains such a throw to this page
      // instead of white-screening the whole app, but containing a crash is
      // not the same as not crashing: coercing to '' keeps the ordering intact and
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

  // One definition, consumed by both the printed report header and the Excel
  // metadata line, so the document and the workbook always describe the same
  // filter state.
  const filterSummary = [
    `From: ${filters['dash-dateFrom'] || 'Any'}`,
    `To: ${filters['dash-dateTo'] || 'Any'}`,
    `Crime Type: ${filters['dash-crimeType'] || 'All'}`,
    `Category: ${filters['dash-category'] || 'All'}`,
    `Sitio: ${filters['dash-sitio'] || 'All'}`,
    `Status: ${filters['dash-status'] || 'All'}`,
  ].join(' · ');

  // ONE projection, shared by the .xlsx and the .csv below, so the two files
  // can never drift apart: same columns, same order, same labels, same rows.
  //
  // The columns are an explicit, ordered projection of the same filtered
  // records the page is showing: no value is altered, nothing is invented, and
  // the internal id/synced_at plumbing is simply not a reporting field.
  const exportSpec = () => ({
    sheetName: 'Crime Records',
    title: 'Crime Reporting Dashboard Report',
    subtitle: 'Crime Data Analytics & Reporting System',
    meta: [`Filters: ${filterSummary}`],
    columns: [
      { header: 'Case Number', key: 'caseNumber', width: 16 },
      { header: 'Date', key: 'date', type: 'date', width: 14 },
      { header: 'Time', key: 'time', width: 10, align: 'center' },
      { header: 'Crime Type', key: 'crimeType', width: 20 },
      { header: 'Category', key: 'category', width: 16 },
      { header: 'Sitio', key: 'sitio', width: 14 },
      { header: 'Street / Location', key: 'street', width: 28, wrap: true },
      { header: 'Status', key: 'status', width: 18, align: 'center' },
      { header: 'Priority', key: 'priority', width: 12, align: 'center' },
      { header: 'Reporting Officer', key: 'reportingOfficer', width: 22 },
      { header: 'Investigating Officer', key: 'investigatingOfficer', width: 22 },
      { header: 'Victim', key: 'victimName', width: 22 },
      { header: 'Suspect', key: 'suspectName', width: 22 },
      { header: 'Description', key: 'description', width: 40, wrap: true },
    ],
    rows: filtered,
    onEmpty: () => showToast('No data to export', 'error'),
    onError: () => showToast('Could not export report.', 'error'),
  });

  const handleExportExcel = async () => {
    const ok = await exportWorkbook({
      filename: `brgy178_dashboard_${today()}.xlsx`,
      ...exportSpec(),
    });
    if (ok) {
      showToast('Dashboard data exported to Excel', 'success');
      // Recorded only on success, so the audit trail never claims an
      // export that did not happen. Not awaited: a completed download
      // must not wait on, or be failed by, follow-up bookkeeping.
      auditLogService.logExport('dashboard');
    }
  };

  // Same projection, same filtered rows, comma-separated. Synchronous because
  // exportCsv needs no dynamic import — see the note there.
  const handleExportCsv = () => {
    const ok = exportCsv({
      filename: `brgy178_dashboard_${today()}.csv`,
      ...exportSpec(),
    });
    if (ok) {
      showToast('Dashboard data exported to CSV', 'success');
      // Same report key as the workbook above: the audit trail records WHICH
      // report left the system, which is the question it exists to answer.
      auditLogService.logExport('dashboard');
    }
  };

  return (
    <section className="module print-root">
      <PrintReport
        title="Crime Reporting Dashboard Report"
        subtitle="Crime Data Analytics &amp; Reporting System"
        meta={[
          `${filtered.length} record${filtered.length === 1 ? '' : 's'}`,
          filterSummary,
        ]}
      >
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

        {/* Print-only key-figures table. The on-screen KPI cards are hidden in
            print (.dashboard-kpi-section is display:none there) because card
            chrome — shadows, rounded tiles, coloured deltas — reads as a web
            dashboard rather than a report. The figures themselves belong in an
            official report, so they are restated here as a plain two-column
            table. Same `allKpis` values the cards use; nothing is recomputed. */}
        <section className="print-only print-section print-kpi-summary">
          <h2 className="print-section-heading">Summary of Key Figures</h2>
          <table>
            <tbody>
              {allKpis.map((k) => (
                <tr key={k.label}>
                  <th scope="row">{k.label}</th>
                  <td>{k.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

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

        {/* ---- Printed report body: charts -------------------------------
            On screen the Dashboard's visuals are the embedded Metabase
            dashboard above. That embed is excluded from print (see the
            .metabase-embed rule in print.css: a fixed 2400px iframe is roughly
            2.4 A4 pages of unbreakable height, it prints blank, and it was the
            cause of the blank leading pages), so the printed report would
            otherwise contain no charts at all.

            These are the same Chart.js charts the Dashboard used before the
            Metabase embed replaced them, driven by exactly the values the KPI
            cards and tables on this page are already computed from — no
            separate query, no recomputation, nothing that can disagree with the
            rest of the document. Each chart is paired with its
            ChartPrintSummary, which restates the same numbers as selectable
            text plus the generated analysis line, so the report is readable
            even in a grayscale photocopy where chart colours are lost.

            .print-charts is laid out off-screen rather than display:none: a
            canvas inside a display:none subtree has a zero-sized box, so
            Chart.js would render nothing and the printed page would show empty
            frames. See the rule in print.css. aria-hidden keeps this duplicate
            of on-screen information out of the accessibility tree, and no
            onOpenSummary is passed so the cards are not focusable either. */}
        <section className="print-charts" aria-hidden="true">
          <h2 className="print-section-heading">Statistical Charts</h2>

          <div className="chart-print-unit">
            <ChartCard
              title="Crime Trend (Monthly)"
              type="line"
              labels={trendMonths}
              datasets={[
                {
                  label: 'Incidents',
                  data: crimeTrendValues,
                  borderColor: COLORS.green,
                  backgroundColor: COLORS.greenLight,
                  fill: true,
                  tension: 0.3,
                },
              ]}
            />
            <ChartPrintSummary
              title="Crime Trend (Monthly)"
              rowLabel="Month"
              valueLabel="Incidents"
              labels={trendMonths}
              values={crimeTrendValues}
              insight={crimeTrendResult.insight}
            />
          </div>

          <div className="chart-print-unit">
            <ChartCard
              title="Crimes by Category"
              type="doughnut"
              labels={categoryLabels}
              datasets={[
                { data: categoryValues, backgroundColor: COLORS.chartPalette },
              ]}
            />
            <ChartPrintSummary
              title="Crimes by Category"
              rowLabel="Category"
              valueLabel="Incidents"
              labels={categoryLabels}
              values={categoryValues}
              insight={categoryResult.insight}
            />
          </div>

          <div className="chart-print-unit">
            <ChartCard
              title="Crimes by Sitio"
              type="bar"
              labels={sitioLabels}
              datasets={[
                {
                  label: 'Incidents',
                  data: sitioValues,
                  backgroundColor: COLORS.green,
                },
              ]}
            />
            <ChartPrintSummary
              title="Crimes by Sitio"
              rowLabel="Sitio"
              valueLabel="Incidents"
              labels={sitioLabels}
              values={sitioValues}
              insight={sitioResult.insight}
            />
          </div>

          <div className="chart-print-unit">
            <ChartCard
              title="Top Crime Types"
              type="bar"
              labels={crimeTypeLabels}
              datasets={[
                {
                  label: 'Count',
                  data: crimeTypeValues,
                  backgroundColor: COLORS.orange,
                },
              ]}
              options={{ indexAxis: 'y' }}
            />
            <ChartPrintSummary
              title="Top Crime Types"
              rowLabel="Crime Type"
              valueLabel="Count"
              labels={crimeTypeLabels}
              values={crimeTypeValues}
              insight={crimeTypeResult.insight}
            />
          </div>

          <div className="chart-print-unit">
            <ChartCard
              title="Resolution Rate Trend"
              type="line"
              labels={months}
              datasets={[
                {
                  label: 'Resolution %',
                  data: resolutionByMonth,
                  borderColor: COLORS.green,
                  tension: 0.3,
                },
              ]}
            />
            <ChartPrintSummary
              title="Resolution Rate Trend"
              rowLabel="Month"
              valueLabel="Resolution %"
              labels={months}
              values={resolutionByMonth}
              insight={resolutionResult.insight}
            />
          </div>

          <div className="chart-print-unit">
            <ChartCard
              title="Incident Status Distribution"
              type="bar"
              labels={statusLabels}
              datasets={[
                {
                  label: 'Count',
                  data: statusValues,
                  backgroundColor: COLORS.statusPalette,
                },
              ]}
            />
            <ChartPrintSummary
              title="Incident Status Distribution"
              rowLabel="Status"
              valueLabel="Count"
              labels={statusLabels}
              values={statusValues}
              insight={statusResult.insight}
            />
          </div>
        </section>

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

        {/* Print-only heading for the four report tables below, so the printed
            document has a labelled section rather than four unexplained tables
            after the charts. Hidden on screen, where the card titles already
            provide the context. */}
        <h2 className="print-section-heading print-only">Detailed Records</h2>

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

        <PrintDocumentEnd />

      </PrintReport>

      <div className="export-bar">
        <Button variant="secondary" onClick={handleExportExcel}>
          <Icons.Download size={15} strokeWidth={2} /> Export Excel
        </Button>
        <Button variant="secondary" onClick={handleExportCsv}>
          <Icons.Download size={15} strokeWidth={2} /> Export CSV
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          <Icons.Printer size={15} strokeWidth={2} /> Print Report
        </Button>
      </div>
    </section>
  );
}
