import { useMemo, useState } from 'react';
import { useData } from '../hooks/useData';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import FilterBar from '../components/ui/FilterBar';
import KpiCard from '../components/ui/KpiCard';
import Table from '../components/ui/Table';
import ChartCard from '../components/charts/ChartCard';
import Button from '../components/ui/Button';
import PrintReport from '../components/ui/PrintReport';
import { filterRecords, countBy, formatDate, exportCSV, today } from '../utils/helpers';
import { COLORS } from '../utils/constants';
import { Icons } from '../components/icons';

export default function Dashboard() {
  const {
    records, settings, SITIOS, CRIME_TYPES, STATUSES,
    getTodayImportedCount, getThisMonthImportedCount,
  } = useData();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const [filters, setFilters] = useState({});

  const filtered = useMemo(
    () => filterRecords(records.filter((r) => r.status !== 'Archived'), {
      // Restored FROM/TO range filtering (matches Records/Mapping/Analytics/
      // Trends). filterRecords compares r.date ('YYYY-MM-DD' string, no Date
      // object / timezone conversion involved) against dateFrom/dateTo with
      // plain string comparison — inclusive on both ends, so selecting TO
      // includes every incident on that date, and leaving either field
      // blank leaves that bound undefined (no accidental empty dataset).
      dateFrom: filters['dash-dateFrom'], dateTo: filters['dash-dateTo'],
      crimeType: filters['dash-crimeType'], sitio: filters['dash-sitio'], status: filters['dash-status'],
    }),
    [records, filters]
  );

  const total = filtered.length;
  const solved = filtered.filter((r) => ['Solved', 'Closed'].includes(r.status)).length;
  const unsolved = filtered.filter((r) => ['Open', 'Under Investigation'].includes(r.status)).length;
  const active = filtered.filter((r) => r.status === 'Under Investigation').length;
  const resolution = total ? ((solved / total) * 100).toFixed(1) : 0;
  const crimeRate = settings.population ? ((total / settings.population) * 1000).toFixed(2) : 0;
  const todayCount = filtered.filter((r) => r.date === today()).length;
  const monthCount = filtered.filter((r) => r.date.startsWith(today().slice(0, 7))).length;

  // Checkpoint 26 — human-readable description of the currently-applied
  // date range, used in the KPI hover hints below so hovering a card tells
  // you exactly which records it's counting.
  const rangeLabel = (() => {
    const from = filters['dash-dateFrom'];
    const to = filters['dash-dateTo'];
    if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
    if (from) return `on or after ${formatDate(from)}`;
    if (to) return `on or before ${formatDate(to)}`;
    return 'all recorded dates';
  })();

  const kpis = [
    { label: 'Total Incidents', value: total, cls: 'accent', hint: `All non-archived incidents for ${rangeLabel}.` },
    { label: 'Solved Cases', value: solved, cls: 'success', hint: `Incidents marked Solved or Closed for ${rangeLabel}.` },
    { label: 'Pending Cases', value: unsolved, cls: 'danger', hint: `Incidents marked Open or Under Investigation for ${rangeLabel}.` },
    { label: 'Active Investigations', value: active, cls: 'warning' },
    { label: 'Resolution Rate', value: `${resolution}%`, cls: 'success' },
    { label: 'Crime Rate /1K', value: crimeRate, cls: 'accent' },
    { label: "Today's Incidents", value: todayCount, cls: 'orange' },
    { label: 'This Month', value: monthCount, cls: 'info' },
    { label: 'Today Imported', value: getTodayImportedCount(), cls: 'accent', hint: 'Records received via sync today — tracks sync activity, independent of the date range filter above.' },
    { label: 'Month Imported', value: getThisMonthImportedCount(), cls: 'info', hint: 'Records received via sync this calendar month — tracks sync activity, independent of the date range filter above.' },
  ];

  // ===== Charts =====
  const monthly = countBy(filtered, (r) => r.date.slice(0, 7));
  const months = Object.keys(monthly).sort();

  const byCat = countBy(filtered, 'category');
  const bySitio = countBy(filtered, 'sitio');
  const sitiosSorted = Object.entries(bySitio).sort((a, b) => b[1] - a[1]);
  const byType = countBy(filtered, 'crimeType');
  const typesSorted = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const resolutionByMonth = months.map((m) => {
    const mr = filtered.filter((r) => r.date.startsWith(m));
    const s = mr.filter((r) => ['Solved', 'Closed'].includes(r.status)).length;
    return mr.length ? +(s / mr.length * 100).toFixed(1) : 0;
  });
  const byStatus = countBy(filtered, 'status');

  // ===== Tables =====
  const recent = [...filtered].sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)).slice(0, 8);
  const locCounts = countBy(filtered, (r) => `${r.sitio}|${r.street}`);
  const hotspots = Object.entries(locCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([k, count]) => { const [sitio, location] = k.split('|'); return { location, sitio, count }; });
  const suspectCounts = countBy(filtered.filter((r) => r.suspectName), 'suspectName');
  const repeat = Object.entries(suspectCounts).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, count]) => ({ name, count }));
  const synced = [...filtered].filter((r) => r.synced_at).sort((a, b) => new Date(b.synced_at) - new Date(a.synced_at)).slice(0, 5);

  return (
    <section className="module">
      <PrintReport title="Crime Reporting Dashboard Report" />
      <div className="dashboard-welcome">
        <h2>Welcome back, <span>{currentUser?.fullName}</span></h2>
        <p>Barangay 178 Crime Data Analytics &amp; Reporting System — North Caloocan</p>
      </div>

      <FilterBar
        fields={[
          { id: 'dash-dateFrom', label: 'From', type: 'date' },
          { id: 'dash-dateTo', label: 'To', type: 'date' },
          { id: 'dash-crimeType', label: 'Crime Type', type: 'select', options: CRIME_TYPES },
          { id: 'dash-sitio', label: 'Sitio', type: 'select', options: SITIOS },
          { id: 'dash-status', label: 'Status', type: 'select', options: STATUSES },
        ]}
        onApply={setFilters}
      />

      <div className="kpi-grid">
        {kpis.map((k) => <KpiCard key={k.label} {...k} />)}
      </div>

      <div className="chart-grid">
        <ChartCard title="Crime Trend (Monthly)" type="line" labels={months}
          datasets={[{ label: 'Incidents', data: months.map((m) => monthly[m]), borderColor: COLORS.green, backgroundColor: COLORS.greenLight, fill: true, tension: 0.3 }]} />
        <ChartCard title="Crimes by Category" type="doughnut" labels={Object.keys(byCat)}
          datasets={[{ data: Object.values(byCat), backgroundColor: COLORS.chartPalette }]} />
        <ChartCard title="Crimes by Sitio" type="bar" labels={sitiosSorted.map((s) => s[0])}
          datasets={[{ label: 'Incidents', data: sitiosSorted.map((s) => s[1]), backgroundColor: COLORS.green }]} />
        <ChartCard title="Top Crime Types" type="bar" labels={typesSorted.map((t) => t[0])}
          datasets={[{ label: 'Count', data: typesSorted.map((t) => t[1]), backgroundColor: COLORS.orange }]}
          options={{ indexAxis: 'y' }} />
        <ChartCard title="Resolution Rate Trend" type="line" labels={months}
          datasets={[{ label: 'Resolution %', data: resolutionByMonth, borderColor: COLORS.green, tension: 0.3 }]} />
        <ChartCard title="Incident Status Distribution" type="bar" labels={Object.keys(byStatus)}
          datasets={[{ label: 'Count', data: Object.values(byStatus), backgroundColor: COLORS.statusPalette }]} />
      </div>

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
            <Table columns={[{ key: 'name', label: 'Suspect' }, { key: 'count', label: 'Incidents' }]} rows={repeat} />
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
                { key: 'synced_at', label: 'Synced', render: (v) => (v ? new Date(v).toLocaleString('en-PH') : '—') },
              ]}
              rows={synced}
            />
          </div>
        </div>
      </div>

      <div className="export-bar">
        <Button variant="secondary" onClick={() => { window.print(); showToast('Use browser print dialog to save as PDF', 'info'); }}><Icons.Report size={15} strokeWidth={2} /> Export PDF</Button>
        <Button variant="secondary" onClick={() => { if (exportCSV(filtered, `brgy178_dashboard_${today()}.csv`, () => showToast('No data to export', 'error'))) showToast('Dashboard data exported', 'success'); }}><Icons.Download size={15} strokeWidth={2} /> Export Excel</Button>
        <Button variant="secondary" onClick={() => window.print()}><Icons.Printer size={15} strokeWidth={2} /> Print Report</Button>
      </div>
    </section>
  );
}
