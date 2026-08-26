import { useEffect, useMemo, useRef } from 'react';
import Chart from 'chart.js/auto';
import { useTheme } from '../../hooks/useTheme';
import { Icons } from '../icons';

// Wraps Chart.js in a React component so every page can declare a chart with
// plain data instead of manually managing canvas refs / chart teardown.
// `type`: 'line' | 'bar' | 'doughnut' | 'pie'  `labels`: string[]  `datasets`: Chart.js dataset[]
export default function ChartCard({
  title,
  type,
  labels,
  datasets,
  options = {},
  height = 260,
  onOpenSummary,
}) {
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
    const gridColor = isDark
      ? 'rgba(255, 255, 255, 0.08)'
      : 'rgba(0, 0, 0, 0.06)';

    const defaults = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: textColor, font: { size: 11 } } },
      },
      scales: ['doughnut', 'pie'].includes(type)
        ? {}
        : {
            x: {
              ticks: { color: textColor, font: { size: 10 } },
              grid: { color: gridColor },
            },
            y: {
              ticks: { color: textColor, font: { size: 10 } },
              grid: { color: gridColor },
              beginAtZero: true,
            },
          },
    };

    chartRef.current?.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type,
      data: { labels, datasets },
      options: { ...defaults, ...options },
    });

    // Print preparation. Two separate problems are handled here:
    //
    // 1. Chart.js draws tooltips directly onto the canvas, so if the mouse is
    //    hovering a data point when print is triggered, the tooltip gets baked
    //    into the printed image. Clearing the active/hover state right before
    //    print (and only then) removes it without affecting normal on-screen
    //    hover behavior.
    //
    // 2. The canvas is a RASTER sized to its on-screen box. Printing re-lays
    //    out the page — print.css gives the wrapper a 55mm height — but the
    //    browser does not re-rasterise the canvas, so the existing bitmap gets
    //    stretched or clipped into the new box. chart.resize() forces Chart.js
    //    to re-measure its container and redraw at the print dimensions, and
    //    raising devicePixelRatio makes that redraw sharp at print resolution
    //    instead of at the ~96dpi the screen used.
    //
    // afterprint restores the screen state, so nothing about normal viewing
    // changes: the chart is resized back and the ratio returned to the
    // device's own value.
    //
    // 3. Axis labels, tick labels and grid lines are drawn in the CURRENT
    //    THEME's colours. In dark mode those are near-white, and a canvas is
    //    a bitmap — the print stylesheet cannot recolour what is already
    //    rasterised — so a chart printed from a dark-themed session came out
    //    with invisible labels on white paper. Print-safe ink is applied here
    //    and reverted afterwards, so the printed report is legible (and stays
    //    legible photocopied in grayscale) regardless of which theme the
    //    person happened to be using.
    const PRINT_INK = '#000000';
    const PRINT_GRID = 'rgba(0, 0, 0, 0.25)';

    // Parameters are named apart from the theme-derived textColor/gridColor
    // above so neither is accidentally shadowed at a call site.
    //
    // Label SIZE is adjusted here as well as colour. The on-screen sizes (10px
    // ticks, 11px legend) are chosen against a ~700px-wide card on a screen
    // viewed from arm's length. Printed into a 170mm-wide box those same
    // numbers came out around 3pt — legible on a monitor at 100% zoom,
    // genuinely hard to read on paper, which is what the axis labels on the
    // Peak Crime Hours and Weekly Trends charts looked like. Both are restored
    // afterwards, so nothing about the screen chart changes.
    const applyPrintTypography = (chart, ink, rule, tickPx, legendPx) => {
      if (chart.options.plugins?.legend?.labels) {
        chart.options.plugins.legend.labels.color = ink;
        chart.options.plugins.legend.labels.font = {
          ...(chart.options.plugins.legend.labels.font || {}),
          size: legendPx,
        };
      }
      Object.values(chart.options.scales || {}).forEach((scale) => {
        if (!scale || typeof scale !== 'object') return;
        if (scale.ticks) {
          scale.ticks.color = ink;
          scale.ticks.font = { ...(scale.ticks.font || {}), size: tickPx };
        }
        if (scale.grid) scale.grid.color = rule;
      });
    };

    const prepareForPrint = () => {
      const chart = chartRef.current;
      if (!chart) return;
      chart.setActiveElements([]);
      chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
      chart.options.devicePixelRatio = 2;
      chart.options.animation = false;
      applyPrintTypography(chart, PRINT_INK, PRINT_GRID, 16, 17);
      chart.resize();
      chart.update('none');
    };

    const restoreAfterPrint = () => {
      const chart = chartRef.current;
      if (!chart) return;
      chart.options.devicePixelRatio = undefined;
      applyPrintTypography(chart, textColor, gridColor, 10, 11);
      chart.resize();
      chart.update('none');
    };

    window.addEventListener('beforeprint', prepareForPrint);
    window.addEventListener('afterprint', restoreAfterPrint);

    return () => {
      window.removeEventListener('beforeprint', prepareForPrint);
      window.removeEventListener('afterprint', restoreAfterPrint);
      chartRef.current?.destroy();
    };
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
        // chart-empty-box gives print.css a hook to collapse this to a single
        // line. On screen it reserves the chart's full height so the card does
        // not jump when data arrives; on paper that would be ~69mm of blank
        // space announcing that there is nothing to show.
        <div
          className="chart-empty-box"
          style={{
            height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div className="empty-state" style={{ padding: '16px 24px' }}>
            <div className="empty-icon">
              <Icons.BarChart3 size={28} strokeWidth={1.5} />
            </div>
            <p style={{ color: 'var(--text-muted)' }}>
              No data for the selected range.
            </p>
          </div>
        </div>
      ) : (
        // chart-print-canvas gives print.css a direct hook for the 55mm
        // print height; the inline px height still governs on screen.
        <div className="chart-print-canvas" style={{ height }}>
          <canvas ref={canvasRef} />
        </div>
      )}
    </div>
  );
}
