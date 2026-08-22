import { api } from './api';

// Fetches a signed, short-lived Metabase embed URL from the Laravel API.
// Mirrors analyticsService.js's pattern — one thin wrapper per endpoint.
// The actual Metabase secret never reaches this file or the browser; the
// backend (App\Services\MetabaseEmbedService) signs the JWT and only ever
// returns the resulting URL.
export const metabaseService = {
  embedUrl: (dashboardKey) => api.get(`/embed/metabase/${dashboardKey}`),
};