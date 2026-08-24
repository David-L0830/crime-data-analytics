import ChartPrintSummary from '../components/charts/ChartPrintSummary';
import MetabaseDashboard from '../components/MetabaseDashboard';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../hooks/useData';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import FilterBar from '../components/ui/FilterBar';
import ChartCard from '../components/charts/ChartCard';
import ChartSummaryModal from '../components/charts/ChartSummaryModal';
import Button from '../components/ui/Button';
import PrintReport from '../components/ui/PrintReport';
import { filterRecords, countBy, formatDate, exportCSV, today, monthLabelToRange } from '../utils/helpers';
import {
  buildCrimeTrendInsight, buildCategoryInsight, buildSitioInsight,
  buildCrimeTypeInsight, buildResolutionInsight, buildStatusInsight,
} from '../utils/chartInsights';
import { COLORS } from '../utils/constants';
import { Icons } from '../components/icons';

export default function Dashboard() {
  const {
    records, settings, SITIOS, CRIME_TYPES, STATUSES,
  } = useData();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({});
  const [selectedChart, setSelectedChart] = useState(null);

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
    if (filters['dash-dateFrom'] || filters['dash-dateTo']) parts.push(`Date: ${rangeLabel}`);
    if (filters['dash-crimeType']) parts.push(`Crime Type: ${filters['dash-crimeType']}`);
    if (filters['dash-sitio']) parts.push(`Sitio: ${filters['dash-sitio']}`);
    if (filters['dash-status']) parts.push(`Status: ${filters['dash-status']}`);
    return parts.length ? parts.join(' | ') : 'None applied';
  })();

  const baseFilters = {
  crimeType: filters['dash-crimeType'],
  sitio: filters['dash-sitio'],
  status: filters['dash-status'],
  dateFrom: filters['dash-dateFrom'],
  dateTo: filters['dash-dateTo'],
};


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
  const crimeTypeResult = buildCrimeTypeInsight(crimeTypeLabels, crimeTypeValues);

  const resolutionResult = buildResolutionInsight(months, resolutionByMonth);

  const statusLabels = Object.keys(byStatus);
  const statusValues = Object.values(byStatus);
  const statusResult = buildStatusInsight(statusLabels, statusValues);

  // ===== Tables =====

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

      {/* Print-only summary of the filters in effect when Export PDF was
          used, so the exported document is self-describing — same pattern
          as Trends.jsx. Hidden on screen via .print-only, shown only
          under @media print. */}
      <div className="print-only" style={{ marginBottom: 14, fontSize: '0.82rem' }}>
        <strong>Filters applied:</strong>{' '}
        From: {filters['dash-dateFrom'] || 'Any'} · To: {filters['dash-dateTo'] || 'Any'} ·
        {' '}Crime Type: {filters['dash-crimeType'] || 'All'} · Sitio: {filters['dash-sitio'] || 'All'} ·
        {' '}Status: {filters['dash-status'] || 'All'}
      </div>


      <MetabaseDashboard dashboardKey="crime" filters={baseFilters} title="Crime Dashboard" height={2400} />

      <MetabaseDashboard dashboardKey="crime_summary" filters={baseFilters} title="Crime Summary" height={2400} />

      <ChartSummaryModal
        open={!!selectedChart}
        onClose={() => setSelectedChart(null)}
        activeFiltersLabel={activeFiltersLabel}
        {...selectedChart}
        onDrillDown={selectedChart?.drillField ? (label) => {
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
          navigate('/incident-feed', { state: { filters: drillFilters } });
        } : undefined}
      />


      <div className="export-bar">
        <Button variant="secondary" onClick={() => { window.print(); showToast('Use browser print dialog to save as PDF', 'info'); }}><Icons.Report size={15} strokeWidth={2} /> Export PDF</Button>
        <Button variant="secondary" onClick={() => { if (exportCSV(filtered, `brgy178_dashboard_${today()}.csv`, () => showToast('No data to export', 'error'))) showToast('Dashboard data exported', 'success'); }}><Icons.Download size={15} strokeWidth={2} /> Export Excel</Button>
        <Button variant="secondary" onClick={() => window.print()}><Icons.Printer size={15} strokeWidth={2} /> Print Report</Button>
      </div>
    </section>
  );
}
