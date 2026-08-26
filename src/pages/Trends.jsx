import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useData } from '../hooks/useData';
import { useToast } from '../hooks/useToast';
import FilterBar from '../components/ui/FilterBar';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import PrintReport, { PrintDocumentEnd } from '../components/ui/PrintReport';
import ChartCard from '../components/charts/ChartCard';
import MetabaseDashboard from '../components/MetabaseDashboard';
import ChartPrintSummary from '../components/charts/ChartPrintSummary';
import ChartSummaryModal from '../components/charts/ChartSummaryModal';
import {
  filterRecords,
  countBy,
  movingAverage,
  linearRegression,
  monthLabelToRange,
} from '../utils/helpers';
import {
  buildDailyPatternInsight,
  buildCrimeTrendInsight,
  buildCategoryInsight,
  buildRegressionInsight,
} from '../utils/chartInsights';
import {
  COLORS,
  SITIOS,
  CRIME_TYPES,
  STATUSES,
  DAY_NAMES,
} from '../utils/constants';
import { Icons } from '../components/icons';

export default function Trends() {
  const {
    records,
    settings,
    markAllNotificationsRead,
    unreadHotspotAlertCount,
  } = useData();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({});
  const [selectedChart, setSelectedChart] = useState(null);
  // Hotspots live in their own panel rather than flooding the module with
  // per-sitio alerts (Part F-19). A "Hotspot Alert" notification click
  // (see Header.jsx) navigates here with { openHotspots: true } so the
  // panel opens and the relevant hotspot is immediately visible.
  const [hotspotsOpen, setHotspotsOpen] = useState(false);
  const [markingHotspotsRead, setMarkingHotspotsRead] = useState(false);

  useEffect(() => {
    if (location.state?.openHotspots) setHotspotsOpen(true);
  }, [location.state]);

  // "Mark All as Read" targets Hotspot Alert notifications specifically —
  // the same read/unread column the topbar bell already uses (see
  // DataContext.markAllNotificationsRead) — not the sitio table below,
  // which reflects live incident counts against the threshold rather than
  // a message inbox and stays visible either way.
  const handleMarkHotspotsRead = async () => {
    if (markingHotspotsRead) return;
    setMarkingHotspotsRead(true);
    try {
      await markAllNotificationsRead('Hotspot Alert');
      showToast('Hotspot alerts marked as read.', 'success');
    } catch {
      showToast(
        'Could not mark hotspot alerts as read. Check your connection and try again.',
        'error',
      );
    } finally {
      setMarkingHotspotsRead(false);
    }
  };

  const filtered = useMemo(
    () =>
      filterRecords(
        records.filter((r) => r.status !== 'Archived'),
        {
          dateFrom: filters['tr-dateFrom'],
          dateTo: filters['tr-dateTo'],
          crimeType: filters['tr-crimeType'],
          sitio: filters['tr-sitio'],
          status: filters['tr-status'],
        },
      ),
    [records, filters],
  );

  const baseFilters = {
    crimeType: filters['tr-crimeType'],
    sitio: filters['tr-sitio'],
    status: filters['tr-status'],
    dateFrom: filters['tr-dateFrom'],
    dateTo: filters['tr-dateTo'],
  };

  const activeFiltersLabel = (() => {
    const from = filters['tr-dateFrom'];
    const to = filters['tr-dateTo'];
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
    if (filters['tr-crimeType'])
      parts.push(`Crime Type: ${filters['tr-crimeType']}`);
    if (filters['tr-sitio']) parts.push(`Sitio: ${filters['tr-sitio']}`);
    if (filters['tr-status']) parts.push(`Status: ${filters['tr-status']}`);
    return parts.length ? parts.join(' | ') : 'None applied';
  })();

  // ===== Alerts (general trend alerts — hotspots are broken out separately below) =====
  const alerts = [];
  const byMonthForAlerts = countBy(filtered, (r) => r.date.slice(0, 7));
  const monthKeysForAlerts = Object.keys(byMonthForAlerts).sort();
  if (monthKeysForAlerts.length >= 2) {
    const last =
      byMonthForAlerts[monthKeysForAlerts[monthKeysForAlerts.length - 1]];
    const prev =
      byMonthForAlerts[monthKeysForAlerts[monthKeysForAlerts.length - 2]];
    if (prev > 0 && last > prev * 1.3) {
      alerts.push({
        type: 'danger',
        icon: Icons.AlertTriangle,
        msg: `Crime surge: ${last} incidents this month vs ${prev} last month (+${((last / prev - 1) * 100).toFixed(0)}%)`,
      });
    }
  }
  const bySitioForAlerts = countBy(filtered, 'sitio');
  const totalForAlerts = filtered.length;
  const byTypeForAlerts = countBy(filtered, 'crimeType');
  Object.entries(byTypeForAlerts).forEach(([type, count]) => {
    const rate = totalForAlerts ? (count / totalForAlerts) * 100 : 0;
    if (rate > 25)
      alerts.push({
        type: 'warning',
        icon: Icons.BarChart3 || Icons.Info,
        msg: `${type} accounts for ${rate.toFixed(1)}% of crimes`,
      });
  });
  const suspectsForAlerts = countBy(
    filtered.filter((r) => r.suspectName),
    'suspectName',
  );
  Object.entries(suspectsForAlerts)
    .filter(([, c]) => c > 1)
    .forEach(([name, count]) => {
      alerts.push({
        type: 'danger',
        icon: Icons.User,
        msg: `Repeat offender: ${name} linked to ${count} incidents`,
      });
    });
  const locCountsForAlerts = countBy(filtered, (r) => `${r.sitio}|${r.street}`);
  Object.entries(locCountsForAlerts)
    .filter(([, c]) => c >= 2)
    .slice(0, 3)
    .forEach(([loc, count]) => {
      const [sitio, location2] = loc.split('|');
      alerts.push({
        type: 'warning',
        icon: Icons.Hotspot,
        msg: `Repeat location: ${location2}, ${sitio} (${count} incidents)`,
      });
    });
  if (settings.population) {
    const crimeRate = (filtered.length / settings.population) * 1000;
    if (crimeRate > settings.threshold) {
      alerts.push({
        type: 'danger',
        icon: Icons.Siren,
        msg: `Crime rate (${crimeRate.toFixed(2)}/1000) exceeds threshold (${settings.threshold})`,
      });
    }
  }

  // ===== Charts =====
  const byDay = DAY_NAMES.map(() => 0);
  filtered.forEach((r) => {
    byDay[new Date(`${r.date}T00:00:00`).getDay()]++;
  });

  const weekNums = {};
  filtered.forEach((r) => {
    const d = new Date(`${r.date}T00:00:00`);
    const week = `W${Math.ceil(d.getDate() / 7)}`;
    const key = `${r.date.slice(0, 7)}-${week}`;
    weekNums[key] = (weekNums[key] || 0) + 1;
  });
  const weeks = Object.keys(weekNums).sort().slice(-12);

  // Phase 4 — Daily/Weekly Trends print data. buildDailyPatternInsight is
  // new (chartInsights.js); buildCrimeTrendInsight is the exact same
  // function Dashboard.jsx's Crime Trend chart already uses, reused here
  // with unitLabel='Week' since Weekly Trends is a real time series too.
  const weeklyValues = weeks.map((w) => weekNums[w]);
  const dailyResult = buildDailyPatternInsight(DAY_NAMES, byDay);
  const weeklyResult = buildCrimeTrendInsight(weeks, weeklyValues, 'Week');

  const seasons = { 'Dry (Nov-Apr)': 0, 'Wet (May-Oct)': 0 };
  filtered.forEach((r) => {
    const m = parseInt(r.date.slice(5, 7), 10);
    if (m >= 5 && m <= 10) seasons['Wet (May-Oct)']++;
    else seasons['Dry (Nov-Apr)']++;
  });
  const seasonLabels = Object.keys(seasons);
  const seasonValues = Object.values(seasons);
  const seasonResult = buildCategoryInsight(seasonLabels, seasonValues);

  const hours = Array(24).fill(0);
  filtered.forEach((r) => {
    if (r.time) hours[parseInt(r.time.split(':')[0], 10)]++;
  });
  const hourLabels = hours.map((_, i) => `${String(i).padStart(2, '0')}:00`);
  const hoursResult = buildDailyPatternInsight(hourLabels, hours);

  const byMonth = countBy(filtered, (r) => r.date.slice(0, 7));
  const monthKeys = Object.keys(byMonth).sort();
  const counts = monthKeys.map((m) => byMonth[m]);
  const ma = movingAverage(counts, 3);
  const forecastResult = buildCrimeTrendInsight(monthKeys, counts, 'Month');

  const points = monthKeys.map((m, i) => [i, byMonth[m]]);
  const { slope, intercept } = linearRegression(points);
  const regression = monthKeys.map(
    (_, i) => +(slope * i + intercept).toFixed(1),
  );
  const nextLabel = monthKeys.length
    ? `Forecast (${monthKeys[monthKeys.length - 1].slice(0, 4)}-${String((parseInt(monthKeys[monthKeys.length - 1].slice(5), 10) % 12) + 1).padStart(2, '0')})`
    : 'Forecast';
  const forecast = [...regression];
  if (monthKeys.length)
    forecast.push(+(slope * monthKeys.length + intercept).toFixed(1));
  const regLabels = [...monthKeys, nextLabel];
  const regressionResult = buildRegressionInsight(
    slope,
    nextLabel,
    forecast[forecast.length - 1],
  );

  // One definition, used by the printed report header so the document says
  // what it is a report OF. Same pattern as Dashboard.jsx / Analytics.jsx.
  const filterSummary = [
    `From: ${filters['tr-dateFrom'] || 'Any'}`,
    `To: ${filters['tr-dateTo'] || 'Any'}`,
    `Crime Type: ${filters['tr-crimeType'] || 'All'}`,
    `Sitio: ${filters['tr-sitio'] || 'All'}`,
    `Status: ${filters['tr-status'] || 'All'}`,
  ].join(' \u00B7 ');

  // ===== Hotspot / location tables (shown only inside the Hotspots panel) =====
  const hotspots = SITIOS.map((s) => ({
    sitio: s,
    count: bySitioForAlerts[s] || 0,
    risk:
      (bySitioForAlerts[s] || 0) >= 5
        ? 'High'
        : (bySitioForAlerts[s] || 0) >= 3
          ? 'Medium'
          : 'Low',
  })).sort((a, b) => b.count - a.count);
  const repeatLocs = Object.entries(locCountsForAlerts)
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, count]) => {
      const [sitio, location2] = k.split('|');
      return { location: location2, sitio, count };
    });
  const riskSitios = SITIOS.map((s) => ({
    sitio: s,
    count: bySitioForAlerts[s] || 0,
    rate: settings.population
      ? (
          ((bySitioForAlerts[s] || 0) / (settings.population / 7)) *
          1000
        ).toFixed(2)
      : '—',
    level: (bySitioForAlerts[s] || 0) >= 3 ? 'High Risk' : 'Normal',
  })).sort((a, b) => b.count - a.count);

  return (
    <section className="module print-root">
      <PrintReport
        title="Trend and Pattern Detection Report"
        subtitle="Crime Data Analytics &amp; Reporting System"
        meta={[
          `${filtered.length} record${filtered.length === 1 ? '' : 's'}`,
          filterSummary,
        ]}
      >
        <FilterBar
          fields={[
            { id: 'tr-dateFrom', label: 'From', type: 'date' },
            { id: 'tr-dateTo', label: 'To', type: 'date' },
            {
              id: 'tr-crimeType',
              label: 'Crime Type',
              type: 'select',
              options: CRIME_TYPES,
            },
            { id: 'tr-sitio', label: 'Sitio', type: 'select', options: SITIOS },
            {
              id: 'tr-status',
              label: 'Status',
              type: 'select',
              options: STATUSES,
            },
          ]}
          onApply={setFilters}
          actions={
            <Button variant="secondary" onClick={() => setHotspotsOpen(true)}>
              <Icons.Hotspot size={15} strokeWidth={2} /> Hotspots
              {unreadHotspotAlertCount > 0 && (
                <span
                  className="notif-bell-count"
                  style={{ position: 'static', marginLeft: 6 }}
                >
                  {unreadHotspotAlertCount}
                </span>
              )}
            </Button>
          }
        />

        {/* The filter state is carried by the PrintReport meta line above, so
            the standalone print-only "Filters applied" paragraph that used to
            sit here would have printed the same sentence twice. */}

        <MetabaseDashboard
          dashboardKey="trends"
          filters={baseFilters}
          height={2000}
        />

        {/* ---- Printed report body: charts -------------------------------
            On screen this module's visuals are the embedded Metabase dashboard
            above, which is excluded from print (a fixed 2000px iframe is ~2 A4
            pages of unbreakable height and prints blank - see the
            .metabase-embed rule in print.css). Without this block the printed
            Trend and Pattern Detection report would be a header and a footer
            with nothing between them.

            These are the same Chart.js charts this page rendered before the
            Metabase embed replaced them, fed by the values already computed
            above from the filtered records, each paired with its
            ChartPrintSummary. .print-charts is laid out off-screen rather than
            display:none because a canvas in a display:none subtree has a
            zero-sized box and Chart.js would render nothing into it - see
            print.css. */}
        <section className="print-charts" aria-hidden="true">
          <h2 className="print-section-heading">Trend and Pattern Charts</h2>

          <div className="chart-print-unit">
            <ChartCard
              title="Daily Trends"
              type="bar"
              labels={DAY_NAMES}
              datasets={[
                {
                  label: 'Incidents',
                  data: byDay,
                  backgroundColor: COLORS.green,
                },
              ]}
            />
            <ChartPrintSummary
              title="Daily Trends"
              rowLabel="Day"
              valueLabel="Incidents"
              labels={DAY_NAMES}
              values={byDay}
              insight={dailyResult.insight}
            />
          </div>

          <div className="chart-print-unit">
            <ChartCard
              title="Weekly Trends"
              type="line"
              labels={weeks}
              datasets={[
                {
                  label: 'Weekly',
                  data: weeklyValues,
                  borderColor: COLORS.green,
                  tension: 0.3,
                },
              ]}
            />
            <ChartPrintSummary
              title="Weekly Trends"
              rowLabel="Week"
              valueLabel="Incidents"
              labels={weeks}
              values={weeklyValues}
              insight={weeklyResult.insight}
            />
          </div>

          <div className="chart-print-unit">
            <ChartCard
              title="Seasonal Trends"
              type="doughnut"
              labels={seasonLabels}
              datasets={[
                {
                  data: seasonValues,
                  backgroundColor: [COLORS.orange, COLORS.green],
                },
              ]}
            />
            <ChartPrintSummary
              title="Seasonal Trends"
              rowLabel="Season"
              valueLabel="Incidents"
              labels={seasonLabels}
              values={seasonValues}
              insight={seasonResult.insight}
            />
          </div>

          <div className="chart-print-unit">
            <ChartCard
              title="Peak Crime Hours"
              type="bar"
              labels={hourLabels}
              datasets={[
                {
                  label: 'Incidents',
                  data: hours,
                  backgroundColor: COLORS.orange,
                },
              ]}
            />
            <ChartPrintSummary
              title="Peak Crime Hours"
              rowLabel="Hour"
              valueLabel="Incidents"
              labels={hourLabels}
              values={hours}
              insight={hoursResult.insight}
            />
          </div>

          <div className="chart-print-unit">
            <ChartCard
              title="Forecast (Moving Avg)"
              type="line"
              labels={monthKeys}
              datasets={[
                {
                  label: 'Actual',
                  data: counts,
                  borderColor: COLORS.green,
                  tension: 0.3,
                },
                {
                  label: 'Moving Avg (3)',
                  data: ma,
                  borderColor: COLORS.orange,
                  borderDash: [5, 5],
                  tension: 0.3,
                },
              ]}
            />
            <ChartPrintSummary
              title="Forecast (Moving Avg)"
              rowLabel="Period"
              labels={monthKeys}
              series={[
                { key: 'actual', label: 'Actual', values: counts },
                {
                  key: 'ma',
                  label: 'Moving Avg',
                  values: ma.map((v) => +v.toFixed(1)),
                },
              ]}
              insight={forecastResult.insight}
            />
          </div>

          <div className="chart-print-unit">
            <ChartCard
              title="Linear Regression"
              type="line"
              labels={regLabels}
              datasets={[
                {
                  label: 'Actual',
                  data: [...counts, null],
                  borderColor: COLORS.green,
                  tension: 0.3,
                },
                {
                  label: 'Regression',
                  data: forecast,
                  borderColor: COLORS.black,
                  borderDash: [3, 3],
                  tension: 0.3,
                },
              ]}
            />
            <ChartPrintSummary
              title="Linear Regression"
              rowLabel="Period"
              labels={regLabels}
              series={[
                { key: 'actual', label: 'Actual', values: [...counts, null] },
                { key: 'regression', label: 'Regression', values: forecast },
              ]}
              insight={regressionResult.insight}
            />
          </div>
        </section>

        {/* Print-only hotspot tables. On screen these live inside the Hotspots
            modal, which is closed by default - so a printed Trends report never
            contained them, even though hotspot analysis is the point of the
            module. Repeating them here as print-only sections puts them in the
            document without changing the on-screen panel, which is untouched
            and still the only way to read them on screen. */}
        <section className="print-only print-section">
          <h2 className="print-section-heading">Crime Hotspots by Sitio</h2>
          <Table
            columns={[
              { key: 'sitio', label: 'Sitio / Location' },
              { key: 'count', label: 'Incidents' },
              { key: 'risk', label: 'Severity' },
            ]}
            rows={hotspots}
            emptyMessage="No hotspot data available."
          />
        </section>

        <section className="print-only print-section">
          <h2 className="print-section-heading">High-Risk Sitios</h2>
          <Table
            columns={[
              { key: 'sitio', label: 'Sitio' },
              { key: 'count', label: 'Incidents' },
              { key: 'rate', label: 'Rate/1K' },
              { key: 'level', label: 'Assessment' },
            ]}
            rows={riskSitios}
          />
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
                  }
                  setSelectedChart(null);
                  navigate('/incident-feed', {
                    state: { filters: drillFilters },
                  });
                }
              : undefined
          }
        />

        <Modal
          open={hotspotsOpen}
          onClose={() => setHotspotsOpen(false)}
          title="Hotspots"
          size="lg"
        >
          <div className="table-grid" style={{ gridTemplateColumns: '1fr' }}>
            <Card title="Active Alerts" bodyClassName="alerts-panel">
              {alerts.length === 0 ? (
                <div className="alert-item success">
                  <span className="alert-icon">
                    <Icons.CheckCircle2 size={16} strokeWidth={2} />
                  </span>
                  No active alerts — crime levels within normal parameters
                </div>
              ) : (
                alerts.slice(0, 8).map((a, i) => {
                  const AlertIcon = a.icon || Icons.AlertTriangle;
                  return (
                    <div
                      className={`alert-item ${a.type === 'warning' ? 'warning' : ''}`}
                      key={i}
                    >
                      <span className="alert-icon">
                        <AlertIcon size={16} strokeWidth={2} />
                      </span>
                      {a.msg}
                    </div>
                  );
                })
              )}
            </Card>
            <Card
              title="Crime Hotspots by Sitio"
              bodyClassName="table-wrap"
              actions={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleMarkHotspotsRead}
                  disabled={markingHotspotsRead || unreadHotspotAlertCount === 0}
                >
                  <Icons.CheckCircle2 size={14} strokeWidth={2} />
                  {markingHotspotsRead ? 'Marking…' : 'Mark All as Read'}
                  {unreadHotspotAlertCount > 0 && (
                    <span
                      className="notif-bell-count"
                      style={{ position: 'static', marginLeft: 6 }}
                    >
                      {unreadHotspotAlertCount}
                    </span>
                  )}
                </Button>
              }
            >
              <Table
                columns={[
                  { key: 'sitio', label: 'Sitio / Location' },
                  { key: 'count', label: 'Incidents' },
                  {
                    key: 'risk',
                    label: 'Severity',
                    render: (v) => (
                      <span
                        style={{
                          color:
                            v === 'High'
                              ? 'var(--danger)'
                              : v === 'Medium'
                                ? 'var(--warning)'
                                : 'var(--success)',
                          fontWeight: 600,
                        }}
                      >
                        {v}
                      </span>
                    ),
                  },
                ]}
                rows={hotspots}
                emptyMessage="No hotspot data available."
              />
            </Card>
            <Card title="Repeat Locations" bodyClassName="table-wrap">
              <Table
                columns={[
                  { key: 'location', label: 'Location' },
                  { key: 'sitio', label: 'Sitio' },
                  { key: 'count', label: 'Incidents' },
                ]}
                rows={repeatLocs}
              />
            </Card>
            <Card title="High-Risk Sitios" bodyClassName="table-wrap">
              <Table
                columns={[
                  { key: 'sitio', label: 'Sitio' },
                  { key: 'count', label: 'Incidents' },
                  { key: 'rate', label: 'Rate/1K' },
                  { key: 'level', label: 'Assessment' },
                ]}
                rows={riskSitios}
              />
            </Card>
          </div>
        </Modal>

        <PrintDocumentEnd />

      </PrintReport>

      <div className="export-bar">
        {/* Named "Print Report" to match Dashboard and Statistical Analysis:
            it opens the browser print dialog, from which the user can print
            or save as PDF. */}
        <Button variant="secondary" onClick={() => window.print()}>
          <Icons.Printer size={15} strokeWidth={2} /> Print Report
        </Button>
      </div>
    </section>
  );
}
