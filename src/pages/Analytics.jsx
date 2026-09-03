import { Icons } from '../components/icons';
import { useMemo, useState } from 'react';
import { useData } from '../hooks/useData';
import { useToast } from '../hooks/useToast';
import FilterBar from '../components/ui/FilterBar';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import ChartCard from '../components/charts/ChartCard';
import MetabaseDashboard from '../components/MetabaseDashboard';
import ChartPrintSummary from '../components/charts/ChartPrintSummary';
import ChartSummaryModal from '../components/charts/ChartSummaryModal';
import PrintReport, { PrintDocumentEnd } from '../components/ui/PrintReport';
import {
  buildCrimeTrendInsight,
  buildCategoryInsight,
  buildSitioInsight,
} from '../utils/chartInsights';
import {
  filterRecords,
  countBy,
  mean,
  median,
  variance,
  stdDev,
  today,
  continuousMonths,
} from '../utils/helpers';
import { exportWorkbook } from '../utils/exportWorkbook';
import { exportCsv } from '../utils/exportCsv';
import { auditLogService } from '../services/auditLogService';
// CRIME_TYPES is NOT imported here: the Crime Type filter below reads the
// configured, enabled vocabulary from useData() instead, so a crime type an
// Administrator adds in System Settings is filterable on this page too.
import { COLORS, SITIOS, STATUSES } from '../utils/constants';

import { useLocation, useNavigate } from 'react-router-dom';
// ...(add to existing import block near the top)

export default function Analytics() {
  const { records, settings, CATEGORIES, CRIME_TYPES } = useData();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [selectedChart, setSelectedChart] = useState(null);
  const [filters, setFilters] = useState(() => {
    const incoming = location.state?.filters;
    if (!incoming) return {};
    return {
      'ana-dateFrom': incoming.dateFrom,
      'ana-dateTo': incoming.dateTo,
      'ana-sitio': incoming.sitio,
    };
  });

  const filtered = useMemo(
    () =>
      filterRecords(
        records.filter((r) => r.status !== 'Archived'),
        {
          dateFrom: filters['ana-dateFrom'],
          dateTo: filters['ana-dateTo'],
          category: filters['ana-category'],
          sitio: filters['ana-sitio'],
          crimeType: filters['ana-crimeType'],
          status: filters['ana-status'],
        },
      ),
    [records, filters],
  );

  const baseFilters = {
    category: filters['ana-category'],
    crimeType: filters['ana-crimeType'],
    sitio: filters['ana-sitio'],
    status: filters['ana-status'],
    dateFrom: filters['ana-dateFrom'],
    dateTo: filters['ana-dateTo'],
  };

  const activeFiltersLabel = (() => {
    const from = filters['ana-dateFrom'];
    const to = filters['ana-dateTo'];
    const parts = [];
    if (from || to) {
      const rangeLabel =
        from && to
          ? `${from} – ${to}`
          : from
            ? `on or after ${from}`
            : `on or before ${to}`;
      parts.push(`Date: ${rangeLabel}`);
    }
    if (filters['ana-category'])
      parts.push(`Category: ${filters['ana-category']}`);
    if (filters['ana-crimeType'])
      parts.push(`Crime Type: ${filters['ana-crimeType']}`);
    if (filters['ana-sitio']) parts.push(`Sitio: ${filters['ana-sitio']}`);
    if (filters['ana-status']) parts.push(`Status: ${filters['ana-status']}`);
    return parts.length ? parts.join(' | ') : 'None applied';
  })();

  const total = filtered.length;
  const solved = filtered.filter((r) =>
    ['Solved', 'Closed'].includes(r.status),
  ).length;

  const stats = [
    {
      label: 'Crime Frequency',
      value: total,
      hint: 'Total number of incidents in the currently filtered date range and criteria.',
    },
    {
      label: 'Crime Rate (/1K)',
      value: settings.population
        ? ((total / settings.population) * 1000).toFixed(2)
        : '—',
      hint: 'Incidents per 1,000 residents, based on the barangay population setting — lets you compare crime volume independent of population size.',
    },
    {
      label: 'Clearance Rate',
      value: total ? `${((solved / total) * 100).toFixed(1)}%` : '0%',
      hint: 'Share of filtered incidents marked Solved or Closed — how many cases have been resolved.',
    },
    {
      label: 'Unique Locations',
      value: new Set(filtered.map((r) => r.street)).size,
      hint: 'Number of distinct streets/addresses represented in the filtered incidents.',
    },
    {
      label: 'Sitios Affected',
      value: new Set(filtered.map((r) => r.sitio)).size,
      hint: 'Number of distinct sitios with at least one filtered incident.',
    },
  ];

  // Keyed by YYYY-MM, like Trends and Dashboard.
  //
  // This used to group by month NAME with the year discarded, then impose order
  // from a hard-coded ['Jan'...'Dec'] array — a display format used as a
  // grouping key, which is not injective over time. Two things went wrong. On a
  // rolling Sep-to-Aug window, which is the default unfiltered view, the series
  // was drawn with the 2026 months first, so a monotonically rising count
  // appeared to rise and then fall off a cliff that does not exist in the data.
  // And over any range covering the same calendar month in two years, both were
  // summed into one bar — which also made this chart's own average disagree
  // with the Mean (monthly) figure in the statistics table on the same page,
  // because that figure was already grouped by YYYY-MM.
  //
  // continuousMonths() then gives the same zero-filled timeline Trends and
  // Dashboard use, so a month with no incidents is a real zero rather than a
  // point the axis skips.
  const byMonth = countBy(filtered, (r) => r.date.slice(0, 7));
  const months = continuousMonths(byMonth);
  const byYear = countBy(filtered, (r) => r.date.slice(0, 4));
  const years = Object.keys(byYear).sort();
  const byCat = countBy(filtered, 'category');
  const byGender = countBy(
    filtered.filter((r) => r.victimGender),
    'victimGender',
  );
  const ages = filtered.filter((r) => r.victimAge).map((r) => r.victimAge);
  const ageBins = ['<20', '20-29', '30-39', '40-49', '50+'];
  const ageCounts = ageBins.map((bin) => {
    if (bin === '<20') return ages.filter((a) => a < 20).length;
    if (bin === '50+') return ages.filter((a) => a >= 50).length;
    const [lo, hi] = bin.split('-').map(Number);
    return ages.filter((a) => a >= lo && a <= hi).length;
  });
  const bySitio = countBy(filtered, 'sitio');

  // Print-only data, derived from the values already computed above —
  // feeds ChartPrintSummary below without changing any existing chart or
  // on-screen calculation. Monthly/Yearly reuse buildCrimeTrendInsight
  // (generic, parameterized by unit label); Category/Sitio reuse their
  // matching existing insight builders. Gender and Age Distribution get a
  // data table only (no insight) since buildCategoryInsight's wording
  // hardcodes the word "category", which doesn't fit those two charts —
  // see chartInsights.js.
  const monthlyPrintValues = months.map((m) => byMonth[m] ?? 0);
  const monthlyTrendResult = buildCrimeTrendInsight(
    months,
    monthlyPrintValues,
    'Month',
  );
  const yearlyPrintValues = years.map((y) => byYear[y]);
  const yearlyTrendResult = buildCrimeTrendInsight(
    years,
    yearlyPrintValues,
    'Year',
  );
  const categoryPrintLabels = Object.keys(byCat);
  const categoryPrintValues = Object.values(byCat);
  const categoryPrintResult = buildCategoryInsight(
    categoryPrintLabels,
    categoryPrintValues,
  );
  const sitioPrintLabels = Object.keys(bySitio);
  const sitioPrintValues = Object.values(bySitio);
  const sitioPrintResult = buildSitioInsight(
    sitioPrintLabels,
    sitioPrintValues,
  );

  // Reuses byMonth above, which is now the same YYYY-MM grouping this line used
  // to recompute for itself. Deliberately Object.values(byMonth) — the months
  // actually PRESENT — and not the zero-filled `months` axis: these measures are
  // documented as covering "the months present in the filtered range", and a
  // month with no incidents is not an observation of zero crimes, it is the
  // absence of one. Feeding zeros in would drag the mean down and inflate the
  // variance. The values here are identical to what this line produced before.
  const monthlyCounts = Object.values(byMonth);
  const measures = [
    {
      label: 'Mean (monthly)',
      value: mean(monthlyCounts).toFixed(2),
      hint: 'Average number of incidents per month across the months present in the filtered range.',
    },
    {
      label: 'Median (monthly)',
      value: median(monthlyCounts).toFixed(2),
      hint: 'Middle value of monthly incident counts when sorted — less skewed by an unusually high or low month than the mean.',
    },
    {
      label: 'Variance',
      value: variance(monthlyCounts).toFixed(2),
      hint: 'How spread out monthly incident counts are from the mean — a higher number means monthly totals vary more widely.',
    },
    {
      label: 'Std Deviation',
      value: stdDev(monthlyCounts).toFixed(2),
      hint: 'The square root of variance — the typical amount a month\u2019s incident count differs from the mean, in the same units as the count itself.',
    },
    {
      label: 'Mean Victim Age',
      value: ages.length ? mean(ages).toFixed(1) : '—',
      hint: 'Average age of victims among filtered incidents that recorded a victim age.',
    },
    {
      label: 'Median Victim Age',
      value: ages.length ? median(ages).toFixed(1) : '—',
      hint: 'Middle victim age when sorted — less affected by a few very young or very old outliers than the mean.',
    },
    ...Object.entries(countBy(filtered, 'category')).map(([cat, count]) => ({
      label: `${cat} %`,
      value: total ? `${((count / total) * 100).toFixed(1)}%` : '0%',
      hint: `Share of filtered incidents classified as ${cat}, out of all filtered incidents.`,
    })),
  ];

  const crosstabCategories = [
    ...new Set(filtered.map((r) => r.category)),
  ].sort();
  const crosstabData = {};
  filtered.forEach((r) => {
    const key = `${r.category}|${r.sitio}`;
    crosstabData[key] = (crosstabData[key] || 0) + 1;
  });
  // One definition, consumed by the printed report header and the Excel
  // metadata line, so the document and the workbook always describe the same
  // filter state. Same pattern as Dashboard.jsx.
  const filterSummary = [
    `From: ${filters['ana-dateFrom'] || 'Any'}`,
    `To: ${filters['ana-dateTo'] || 'Any'}`,
    `Category: ${filters['ana-category'] || 'All'}`,
    `Crime Type: ${filters['ana-crimeType'] || 'All'}`,
    `Sitio: ${filters['ana-sitio'] || 'All'}`,
    `Status: ${filters['ana-status'] || 'All'}`,
  ].join(' \u00B7 ');

  const crosstabRows = crosstabCategories.map((cat) => {
    const row = { category: cat };
    SITIOS.forEach((s) => {
      row[s] = crosstabData[`${cat}|${s}`] || 0;
    });
    row.total = SITIOS.reduce((sum, s) => sum + row[s], 0);
    return row;
  });
  const crosstabCols = [
    { key: 'category', label: 'Category' },
    ...SITIOS.map((s) => ({ key: s, label: s })),
    { key: 'total', label: 'Total' },
  ];

  // ONE projection, shared by the .xlsx and the .csv below, so the two files
  // can never drift apart: same columns, same order, same labels, same rows.
  //
  // The columns are an explicit, ordered projection of the same `filtered`
  // records the on-screen analysis is computed from. No value is altered and
  // nothing is invented. (The Excel button here once wrote a .csv; the two
  // formats are now genuinely separate buttons producing their own file.)
  const exportSpec = () => ({
    sheetName: 'Statistical Analysis',
    title: 'Statistical Analysis Report',
    subtitle: 'Crime Data Analytics & Reporting System',
    meta: [`Filters: ${filterSummary}`],
    columns: [
      { header: 'Case Number', key: 'caseNumber', width: 16 },
      { header: 'Date', key: 'date', type: 'date', width: 14 },
      { header: 'Time', key: 'time', width: 10, align: 'center' },
      { header: 'Crime Type', key: 'crimeType', width: 20 },
      { header: 'Category', key: 'category', width: 18 },
      { header: 'Sitio', key: 'sitio', width: 14 },
      { header: 'Street / Location', key: 'street', width: 28, wrap: true },
      { header: 'Status', key: 'status', width: 18, align: 'center' },
      { header: 'Victim', key: 'victimName', width: 22 },
      { header: 'Victim Age', key: 'victimAge', type: 'number', width: 11 },
      {
        header: 'Victim Gender',
        key: 'victimGender',
        width: 13,
        align: 'center',
      },
      { header: 'Suspect', key: 'suspectName', width: 22 },
      { header: 'Reporting Officer', key: 'reportingOfficer', width: 22 },
    ],
    rows: filtered,
    onEmpty: () => showToast('No data to export', 'error'),
    onError: () => showToast('Could not export report.', 'error'),
  });

  const handleExportExcel = async () => {
    const ok = await exportWorkbook({
      filename: `brgy178_analytics_${today()}.xlsx`,
      ...exportSpec(),
    });
    if (ok) {
      showToast('Statistical analysis exported to Excel', 'success');
      // Recorded only on success, so the audit trail never claims an
      // export that did not happen. Not awaited: a completed download
      // must not wait on, or be failed by, follow-up bookkeeping.
      auditLogService.logExport('analytics');
    }
  };

  // Same projection, same filtered rows, comma-separated. Synchronous because
  // exportCsv needs no dynamic import — see the note there.
  const handleExportCsv = () => {
    const ok = exportCsv({
      filename: `brgy178_analytics_${today()}.csv`,
      ...exportSpec(),
    });
    if (ok) {
      showToast('Statistical analysis exported to CSV', 'success');
      // Same report key as the workbook above: the audit trail records WHICH
      // report left the system, which is the question it exists to answer.
      auditLogService.logExport('analytics');
    }
  };

  return (
    <section className="module print-root">
      <PrintReport
        title="Statistical Analysis Report"
        subtitle="Crime Data Analytics &amp; Reporting System"
        meta={[
          `${filtered.length} record${filtered.length === 1 ? '' : 's'}`,
          filterSummary,
        ]}
      >
        <FilterBar
          fields={[
            { id: 'ana-dateFrom', label: 'From', type: 'date' },
            { id: 'ana-dateTo', label: 'To', type: 'date' },
            {
              id: 'ana-category',
              label: 'Category',
              type: 'select',
              options: CATEGORIES,
            },
            {
              id: 'ana-crimeType',
              label: 'Crime Type',
              type: 'select',
              options: CRIME_TYPES,
            },
            {
              id: 'ana-sitio',
              label: 'Sitio',
              type: 'select',
              options: SITIOS,
            },
            {
              id: 'ana-status',
              label: 'Status',
              type: 'select',
              options: STATUSES,
            },
          ]}
          onApply={setFilters}
        />

        {/* The filter state is carried by the PrintReport meta line above, so
            the standalone print-only "Filters applied" paragraph that used to
            sit here would have printed the same sentence twice. */}

        <div className="analytics-stats-section">
          <div className="stats-summary">
            {stats.map((s) => (
              <div
                className="stat-box"
                key={s.label}
                title={s.hint}
                tabIndex={s.hint ? 0 : undefined}
              >
                <div className="label">{s.label}</div>
                <div className="value">{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        <MetabaseDashboard
          dashboardKey="analytics"
          filters={baseFilters}
          height={2000}
        />

        {/* Print-only restatement of the summary statistics. The on-screen
            .analytics-stats-section is hidden in print (see print.css) because
            KPI tiles read as a web dashboard; the figures themselves belong in
            the report, so they are repeated here as a plain table. Same
            `stats` array the tiles render - nothing is recomputed. */}
        <section className="print-only print-section print-kpi-summary">
          <h2 className="print-section-heading">Summary of Key Figures</h2>
          <table>
            <tbody>
              {stats.map((st) => (
                <tr key={st.label}>
                  <th scope="row">{st.label}</th>
                  <td>{st.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* ---- Printed report body: charts -------------------------------
            On screen this module's visuals are the embedded Metabase dashboard
            above, which is excluded from print (a fixed 2000px iframe is ~2 A4
            pages of unbreakable height and prints blank - see the
            .metabase-embed rule in print.css). Without this block the printed
            Statistical Analysis report would carry no charts at all.

            These are the same Chart.js charts this page rendered before the
            Metabase embed replaced them, fed by the values already computed
            above for the filtered records, each paired with its
            ChartPrintSummary so the numbers survive a grayscale photocopy.
            .print-charts is laid out off-screen rather than display:none
            because a canvas in a display:none subtree has a zero-sized box and
            Chart.js would render nothing into it - see print.css. */}
        <section className="print-charts" aria-hidden="true">
          <h2 className="print-section-heading">Statistical Charts</h2>

          <div className="chart-print-unit">
            <ChartCard
              title="Monthly Distribution"
              type="bar"
              labels={months}
              datasets={[
                {
                  label: 'Crimes',
                  data: monthlyPrintValues,
                  backgroundColor: COLORS.green,
                },
              ]}
            />
            <ChartPrintSummary
              title="Monthly Distribution"
              rowLabel="Month"
              valueLabel="Crimes"
              labels={months}
              values={monthlyPrintValues}
              insight={monthlyTrendResult.insight}
            />
          </div>

          <div className="chart-print-unit">
            <ChartCard
              title="Yearly Comparison"
              type="line"
              labels={years}
              datasets={[
                {
                  label: 'Crimes',
                  data: yearlyPrintValues,
                  borderColor: COLORS.orange,
                  tension: 0.3,
                },
              ]}
            />
            <ChartPrintSummary
              title="Yearly Comparison"
              rowLabel="Year"
              valueLabel="Crimes"
              labels={years}
              values={yearlyPrintValues}
              insight={yearlyTrendResult.insight}
            />
          </div>

          <div className="chart-print-unit">
            <ChartCard
              title="Category Distribution"
              type="pie"
              labels={categoryPrintLabels}
              datasets={[
                {
                  data: categoryPrintValues,
                  backgroundColor: COLORS.chartPalette,
                },
              ]}
            />
            <ChartPrintSummary
              title="Category Distribution"
              rowLabel="Category"
              valueLabel="Incidents"
              labels={categoryPrintLabels}
              values={categoryPrintValues}
              insight={categoryPrintResult.insight}
            />
          </div>

          <div className="chart-print-unit">
            <ChartCard
              title="Gender Distribution"
              type="doughnut"
              labels={Object.keys(byGender)}
              datasets={[
                {
                  data: Object.values(byGender),
                  backgroundColor: [COLORS.green, COLORS.orange],
                },
              ]}
            />
            <ChartPrintSummary
              title="Gender Distribution"
              rowLabel="Gender"
              valueLabel="Incidents"
              labels={Object.keys(byGender)}
              values={Object.values(byGender)}
            />
          </div>

          <div className="chart-print-unit">
            <ChartCard
              title="Age Distribution"
              type="bar"
              labels={ageBins}
              datasets={[
                {
                  label: 'Victims',
                  data: ageCounts,
                  backgroundColor: COLORS.black,
                },
              ]}
            />
            <ChartPrintSummary
              title="Age Distribution"
              rowLabel="Age Range"
              valueLabel="Victims"
              labels={ageBins}
              values={ageCounts}
            />
          </div>

          <div className="chart-print-unit">
            <ChartCard
              title="Sitio Breakdown"
              type="bar"
              labels={sitioPrintLabels}
              datasets={[
                {
                  label: 'Incidents',
                  data: sitioPrintValues,
                  backgroundColor: COLORS.orange,
                },
              ]}
            />
            <ChartPrintSummary
              title="Sitio Breakdown"
              rowLabel="Sitio"
              valueLabel="Incidents"
              labels={sitioPrintLabels}
              values={sitioPrintValues}
              insight={sitioPrintResult.insight}
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
                  if (selectedChart.drillField === 'category') {
                    drillFilters.category = label;
                  } else if (selectedChart.drillField === 'sitio') {
                    drillFilters.sitio = label;
                  }
                  setSelectedChart(null);
                  navigate('/incident-feed', {
                    state: { filters: drillFilters },
                  });
                }
              : undefined
          }
        />

        <Card title="Statistical Measures">
          <div className="stat-measures">
            {measures.map((m) => (
              <div
                className="stat-box"
                key={m.label}
                title={m.hint}
                tabIndex={m.hint ? 0 : undefined}
              >
                <div className="label">{m.label}</div>
                <div className="value">{m.value}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="Cross Tabulation (Category × Sitio)"
          bodyClassName="table-wrap"
        >
          <Table columns={crosstabCols} rows={crosstabRows} />
        </Card>

        <PrintDocumentEnd />
      </PrintReport>

      <div className="export-bar">
        {/* Named "Print Report" to match Dashboard: it opens the browser
            print dialog, from which the user can print or save as PDF. */}
        <Button variant="secondary" onClick={() => window.print()}>
          <Icons.Printer size={15} strokeWidth={2} /> Print Report
        </Button>
        <Button variant="secondary" onClick={handleExportExcel}>
          <Icons.Download size={15} strokeWidth={2} /> Export Excel
        </Button>
        <Button variant="secondary" onClick={handleExportCsv}>
          <Icons.Download size={15} strokeWidth={2} /> Export CSV
        </Button>
      </div>
    </section>
  );
}
