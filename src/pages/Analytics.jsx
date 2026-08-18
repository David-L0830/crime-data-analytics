import { Icons } from '../components/icons';
import { useMemo, useState } from 'react';
import { useData } from '../hooks/useData';
import { useToast } from '../hooks/useToast';
import FilterBar from '../components/ui/FilterBar';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import ChartCard from '../components/charts/ChartCard';
import { filterRecords, countBy, mean, median, variance, stdDev, exportCSV, today } from '../utils/helpers';
import { COLORS, SITIOS } from '../utils/constants';

const MONTH_ORDER = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

import { useLocation } from 'react-router-dom';
// ...(add to existing import block near the top)

export default function Analytics() {
  const { records, settings, CATEGORIES } = useData();
  const { showToast } = useToast();
  const location = useLocation();
  const [filters, setFilters] = useState(() => {
    const incoming = location.state?.filters;
    if (!incoming) return {};
    return { 'ana-dateFrom': incoming.dateFrom, 'ana-dateTo': incoming.dateTo, 'ana-sitio': incoming.sitio };
  });

  const filtered = useMemo(
    () => filterRecords(records.filter((r) => r.status !== 'Archived'), {
      dateFrom: filters['ana-dateFrom'], dateTo: filters['ana-dateTo'],
      category: filters['ana-category'], sitio: filters['ana-sitio'],
    }),
    [records, filters]
  );

  const total = filtered.length;
  const solved = filtered.filter((r) => ['Solved', 'Closed'].includes(r.status)).length;

  const stats = [
    { label: 'Crime Frequency', value: total, hint: 'Total number of incidents in the currently filtered date range and criteria.' },
    { label: 'Crime Rate (/1K)', value: settings.population ? ((total / settings.population) * 1000).toFixed(2) : '—', hint: 'Incidents per 1,000 residents, based on the barangay population setting — lets you compare crime volume independent of population size.' },
    { label: 'Clearance Rate', value: total ? `${((solved / total) * 100).toFixed(1)}%` : '0%', hint: 'Share of filtered incidents marked Solved or Closed — how many cases have been resolved.' },
    { label: 'Unique Locations', value: new Set(filtered.map((r) => r.street)).size, hint: 'Number of distinct streets/addresses represented in the filtered incidents.' },
    { label: 'Sitios Affected', value: new Set(filtered.map((r) => r.sitio)).size, hint: 'Number of distinct sitios with at least one filtered incident.' },
  ];

  const byMonth = countBy(filtered, (r) => new Date(`${r.date}T00:00:00`).toLocaleString('en', { month: 'short' }));
  const months = MONTH_ORDER.filter((m) => byMonth[m]);
  const byYear = countBy(filtered, (r) => r.date.slice(0, 4));
  const years = Object.keys(byYear).sort();
  const byCat = countBy(filtered, 'category');
  const byGender = countBy(filtered.filter((r) => r.victimGender), 'victimGender');
  const ages = filtered.filter((r) => r.victimAge).map((r) => r.victimAge);
  const ageBins = ['<20', '20-29', '30-39', '40-49', '50+'];
  const ageCounts = ageBins.map((bin) => {
    if (bin === '<20') return ages.filter((a) => a < 20).length;
    if (bin === '50+') return ages.filter((a) => a >= 50).length;
    const [lo, hi] = bin.split('-').map(Number);
    return ages.filter((a) => a >= lo && a <= hi).length;
  });
  const bySitio = countBy(filtered, 'sitio');

  const monthlyCounts = Object.values(countBy(filtered, (r) => r.date.slice(0, 7)));
  const measures = [
    { label: 'Mean (monthly)', value: mean(monthlyCounts).toFixed(2), hint: 'Average number of incidents per month across the months present in the filtered range.' },
    { label: 'Median (monthly)', value: median(monthlyCounts).toFixed(2), hint: 'Middle value of monthly incident counts when sorted — less skewed by an unusually high or low month than the mean.' },
    { label: 'Variance', value: variance(monthlyCounts).toFixed(2), hint: 'How spread out monthly incident counts are from the mean — a higher number means monthly totals vary more widely.' },
    { label: 'Std Deviation', value: stdDev(monthlyCounts).toFixed(2), hint: 'The square root of variance — the typical amount a month\u2019s incident count differs from the mean, in the same units as the count itself.' },
    { label: 'Mean Victim Age', value: ages.length ? mean(ages).toFixed(1) : '—', hint: 'Average age of victims among filtered incidents that recorded a victim age.' },
    { label: 'Median Victim Age', value: ages.length ? median(ages).toFixed(1) : '—', hint: 'Middle victim age when sorted — less affected by a few very young or very old outliers than the mean.' },
    ...Object.entries(countBy(filtered, 'category')).map(([cat, count]) => ({
      label: `${cat} %`, value: total ? `${((count / total) * 100).toFixed(1)}%` : '0%',
      hint: `Share of filtered incidents classified as ${cat}, out of all filtered incidents.`,
    })),
  ];

  const crosstabCategories = [...new Set(filtered.map((r) => r.category))].sort();
  const crosstabData = {};
  filtered.forEach((r) => { const key = `${r.category}|${r.sitio}`; crosstabData[key] = (crosstabData[key] || 0) + 1; });
  const crosstabRows = crosstabCategories.map((cat) => {
    const row = { category: cat };
    SITIOS.forEach((s) => { row[s] = crosstabData[`${cat}|${s}`] || 0; });
    row.total = SITIOS.reduce((sum, s) => sum + row[s], 0);
    return row;
  });
  const crosstabCols = [
    { key: 'category', label: 'Category' },
    ...SITIOS.map((s) => ({ key: s, label: s })),
    { key: 'total', label: 'Total' },
  ];

  return (
    <section className="module">
      <FilterBar
        fields={[
          { id: 'ana-dateFrom', label: 'From', type: 'date' },
          { id: 'ana-dateTo', label: 'To', type: 'date' },
          { id: 'ana-category', label: 'Category', type: 'select', options: CATEGORIES },
          { id: 'ana-sitio', label: 'Sitio', type: 'select', options: SITIOS },
        ]}
        onApply={setFilters}
      />

      <div className="stats-summary">
        {stats.map((s) => (
          <div className="stat-box" key={s.label} title={s.hint} tabIndex={s.hint ? 0 : undefined}>
            <div className="label">{s.label}</div>
            <div className="value">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="chart-grid">
        <ChartCard title="Monthly Distribution" type="bar" labels={months}
          datasets={[{ label: 'Crimes', data: months.map((m) => byMonth[m]), backgroundColor: COLORS.green }]} />
        <ChartCard title="Yearly Comparison" type="line" labels={years}
          datasets={[{ label: 'Crimes', data: years.map((y) => byYear[y]), borderColor: COLORS.orange, tension: 0.3 }]} />
        <ChartCard title="Category Distribution" type="pie" labels={Object.keys(byCat)}
          datasets={[{ data: Object.values(byCat), backgroundColor: COLORS.chartPalette }]} />
        <ChartCard title="Gender Distribution" type="doughnut" labels={Object.keys(byGender)}
          datasets={[{ data: Object.values(byGender), backgroundColor: [COLORS.green, COLORS.orange] }]} />
        <ChartCard title="Age Distribution" type="bar" labels={ageBins}
          datasets={[{ label: 'Victims', data: ageCounts, backgroundColor: COLORS.black }]} />
        <ChartCard title="Sitio Breakdown" type="bar" labels={Object.keys(bySitio)}
          datasets={[{ label: 'Incidents', data: Object.values(bySitio), backgroundColor: COLORS.orange }]} />
      </div>

      <Card title="Statistical Measures">
        <div className="stat-measures">
          {measures.map((m) => (
            <div className="stat-box" key={m.label} title={m.hint} tabIndex={m.hint ? 0 : undefined}>
              <div className="label">{m.label}</div>
              <div className="value">{m.value}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Cross Tabulation (Category × Sitio)" bodyClassName="table-wrap">
        <Table columns={crosstabCols} rows={crosstabRows} />
      </Card>

      <div className="export-bar">
        <Button variant="secondary" onClick={() => { if (exportCSV(filtered, `brgy178_analytics_${today()}.csv`, () => showToast('No data to export', 'error'))) showToast('Analytics exported', 'success'); }}><Icons.Download size={15} strokeWidth={2} /> Export CSV</Button>
        <Button variant="secondary" onClick={() => { if (exportCSV(filtered, `brgy178_analytics_${today()}.csv`, () => showToast('No data to export', 'error'))) showToast('Analytics exported', 'success'); }}><Icons.Report size={15} strokeWidth={2} /> Export Excel</Button>
      </div>
    </section>
  );
}
