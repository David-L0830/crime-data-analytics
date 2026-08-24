import { api } from './api';

// Fetches a signed, short-lived Metabase embed URL from the Laravel API.
// Mirrors analyticsService.js's pattern — one thin wrapper per endpoint.
// The actual Metabase secret never reaches this file or the browser; the
// backend (App\Services\MetabaseEmbedService) signs the JWT and only ever
// returns the resulting URL.
function buildMetabaseQuery(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, value);
    }
  });
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const metabaseService = {
  embedUrl: (dashboardKey, filters = {}) =>
    api.get(`/embed/metabase/${dashboardKey}${buildMetabaseQuery(filters)}`),
};