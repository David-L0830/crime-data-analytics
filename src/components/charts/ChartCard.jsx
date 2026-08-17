import { useEffect, useMemo, useRef } from 'react';
import Chart from 'chart.js/auto';
import { useTheme } from '../../hooks/useTheme';
import { Icons } from '../icons';

// Wraps Chart.js in a React component so every page can declare a chart with
// plain data instead of manually managing canvas refs / chart teardown.
// `type`: 'line' | 'bar' | 'doughnut' | 'pie'  `labels`: string[]  `datasets`: Chart.js dataset[]
export default function ChartCard({ title, type, labels, datasets, options = {}, height = 260, onOpenSummary }) {
  console.log('ChartCard render:', title, '— onOpenSummary is', typeof onOpenSummary);
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const { theme } = useTheme();

  // Checkpoint 26 — no-result state: when the selected date range has no
  // matching records, `labels` ends up empty (e.g. no months/categories to
  // plot at all) and Chart.js would otherwise render a blank, unexplained
  // canvas. Deliberately keyed on "no categories" rather than "all values
  // are zero" — a chart showing real zero counts (e.g. 0% resolution rate
  // for a month that had incidents but none solved yet) is legitimate data,
  // not a no-result state, and should still render normally.
  const isEmpty = useMemo(() => !labels?.length, [labels]);

  useEffect(() => {
    if (!canvasRef.current || isEmpty) {
      chartRef.current?.destroy();
      chartRef.current = null;
      return undefined;
    }

    const isDark = theme === 'dark';
    const textColor = isDark ? 'rgba(255, 255, 255, 0.7)' : '#555555';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

    const defaults = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: textColor, font: { size: 11 } } },
      },
      scales: ['doughnut', 'pie'].includes(type)
        ? {}
        : {
            x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
            y: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor }, beginAtZero: true },
          },
    };

    chartRef.current?.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type,
      data: { labels, datasets },
      options: { ...defaults, ...options },
    });

    return () => chartRef.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, JSON.stringify(labels), JSON.stringify(datasets), theme, isEmpty]);

  const interactive = typeof onOpenSummary === 'function';

  const handleKeyDown = (e) => {
    if (!interactive) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpenSummary();
    }
  };

  return (
    <div
      className={`card chart-card${interactive ? ' chart-card-interactive' : ''}`}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `View summary for ${title}` : undefined}
      onClick={interactive ? onOpenSummary : undefined}
      onKeyDown={handleKeyDown}
    >
      {title && <h3>{title}</h3>}
      {interactive && <span className="chart-card-hint">View summary</span>}
      {isEmpty ? (
        <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="empty-state" style={{ padding: '16px 24px' }}>
            <div className="empty-icon"><Icons.BarChart3 size={28} strokeWidth={1.5} /></div>
            <p style={{ color: 'var(--text-muted)' }}>No data for the selected range.</p>
          </div>
        </div>
      ) : (
        <div style={{ height }}>
          <canvas ref={canvasRef} />
        </div>
      )}
    </div>
  );
}
