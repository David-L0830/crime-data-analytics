import { useEffect, useMemo, useState } from 'react';
import { metabaseService } from '../services/metabaseService';
import { Icons } from './icons';
import { useTheme } from '../hooks/useTheme';

// Sets one key in an embed URL's hash fragment, leaving every other key byte
// for byte as it was.
//
// Deliberately a targeted string edit rather than URLSearchParams: round
// tripping the fragment would percent-encode the commas in
// `hide_parameters=date_range,crime_type,...`, and that list is what keeps
// Metabase's own filter widgets hidden so the React FilterBar remains the
// single source of truth for filtering.
function setFragmentParam(fragment, key, value) {
  const pattern = new RegExp(`(^|&)${key}=[^&]*`);
  if (pattern.test(fragment)) {
    return fragment.replace(pattern, `$1${key}=${value}`);
  }
  return fragment ? `${fragment}&${key}=${value}` : `${key}=${value}`;
}

// Applies the app's colour scheme to the embedded dashboard.
//
// Verified against the embed bundle of the installed Metabase (v0.63.14), whose
// theme resolver is:
//
//     switch (e) {
//       case "light": case "transparent": case undefined: return "light";
//       case "night": case "dark":                        return "dark";
//     }
//
// `theme` selects a COLOUR SCHEME only. `transparent` is not a third scheme —
// it resolves to LIGHT, which is why config/metabase.php's `theme=transparent`
// produced the original dark-mode bug: it suppressed the background but left
// the light theme's near-black text, so titles, axis labels, axis values,
// legend text and the donut's centre total all but disappeared on a dark card.
//
// Dark mode therefore sets TWO independent options:
//
//   theme=night       Metabase's dark scheme — light text, and native
//                     dark-theme gridlines, borders and chart styling.
//   background=false  Suppresses the dashboard surface, so the app's own
//                     --bg-card (#1b221a) shows through instead of Metabase's
//                     navy. Independent of `theme`; the embed route parses both
//                     from the same hash.
//
// IMPORTANT, and the reason this looked broken when it was first tried:
// `background=false` only removes the DASHBOARD-level surface. Each card keeps
// its own fill unless that card's `dashcard.background` visualization setting
// is false — it is the "Show background" toggle under a card's Display options
// in the Metabase dashboard editor, and it DEFAULTS TO TRUE:
//
//     "dashcard.background": { getSection: () => t`Display`,
//                              title: () => t`Show background`,
//                              widget: "toggle", getDefault: () => true }
//
// So this setting alone is not sufficient: the cards in all three dashboards
// must also have "Show background" switched off in Metabase. If navy card
// panels reappear, that card-level toggle has been turned back on — the fix is
// there, not here.
//
// Custom dark colours matching the app exactly are NOT possible on this
// instance. The palette resolver accepts overrides only from `whitelabelColors`
// (Admin -> Appearance) or `embeddingThemeOverride` (Embedded Analytics SDK),
// and this server reports whitelabel:false and embedding_sdk:false — it is
// Metabase OSS. Suppressing the background so the app's own colour shows
// through is the supported way to get there.
//
// No CSS override, no reverse proxy, and nothing reaching inside the iframe,
// which is impossible cross-origin anyway.
//
// The hash fragment is display-only: Metabase's embed page reads it in the
// browser, while the signed JWT and every locked filter parameter live in the
// URL PATH and are untouched here, so this cannot change which data the
// dashboard is allowed to show. That is also why the theme is applied in the
// browser rather than round-tripped through the API — the server does not know
// which theme the viewer chose, and asking it would mint a fresh signed token
// on every toggle for a purely cosmetic change.
//
// In LIGHT mode the URL is returned byte for byte as the backend built it, so
// the existing light appearance is preserved exactly.
function applyEmbedTheme(url, theme) {
  if (!url || theme !== 'dark') return url;

  const hashAt = url.indexOf('#');
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const fragment = hashAt === -1 ? '' : url.slice(hashAt + 1);

  let next = setFragmentParam(fragment, 'theme', 'night');
  next = setFragmentParam(next, 'background', 'false');

  return `${base}#${next}`;
}

// Renders a signed Metabase dashboard inside an iframe.
//
// The wrapper carries `metabase-embed` purely so print.css can exclude it —
// see the rule there. In short: this is a fixed-height (2000-2400px) embedded
// BI surface, which is 2 to 2.4 A4 pages of unbreakable height that prints
// blank, and it was the reason Dashboard/Analytics/Trends emitted blank pages
// ahead of their real content. Fetches a
// fresh, short-lived embed URL from the Laravel API on mount (and
// whenever `dashboardKey` changes) — the actual Metabase secret never
// reaches this component; it only ever receives the finished URL.
export default function MetabaseDashboard({
  dashboardKey,
  filters = {},
  title,
  height = 800,
}) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const { theme } = useTheme();

  const themedUrl = useMemo(() => applyEmbedTheme(url, theme), [url, theme]);

  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    metabaseService
      .embedUrl(dashboardKey, filters)
      .then((data) => {
        if (!cancelled) setUrl(data?.url || null);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err.message || 'Unable to load analytics dashboard.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardKey, filterKey]);

  if (loading) {
    return (
      <div
        className="metabase-embed card"
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="spinner" />
      </div>
    );
  }

  if (error || !url) {
    return (
      <div
        className="metabase-embed card"
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
            {error || 'Analytics dashboard is not available right now.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="metabase-embed card"
      style={{ padding: 0, overflow: 'hidden' }}
    >
      {title && <h3 style={{ padding: '16px 16px 0' }}>{title}</h3>}
      {/* No `allowTransparency`: it was a non-standard IE-only attribute that
          every current browser ignores, and React 19 no longer recognises it,
          so it reached the DOM as an unknown attribute and logged a warning on
          every render. Dropping it changes nothing visually — an iframe is
          already transparent by default, and the embedded Metabase document
          paints its own background regardless. The src, sizing, border and the
          embed flow behind `url` are untouched. */}
      <iframe
        // Keyed on the theme so switching it genuinely reloads the frame.
        // Toggling changes only the URL's fragment, and a fragment-only change
        // is same-document navigation — the frame would not necessarily
        // re-request the page, and Metabase reads the theme once at load. A new
        // key forces a fresh element, and therefore a real load.
        key={theme}
        src={themedUrl}
        title={title || dashboardKey}
        width="100%"
        height={height}
        style={{ border: 'none' }}
      />
    </div>
  );
}
