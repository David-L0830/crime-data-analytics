// Reads the GET /settings/metabase-status payload for the System Settings
// panel. Pure, so the wording is testable without rendering.

// What is missing, in the order an operator would fix it: site URL, then the
// secret, then each dashboard. Empty when embedding is ready.
export function missingMetabaseSettings(status) {
  if (!status) return [];
  const missing = [];
  if (!status.siteUrlConfigured) missing.push('Metabase site URL');
  if (!status.embeddingSecretConfigured) missing.push('embedding secret key');
  for (const dashboard of status.dashboards || []) {
    if (!dashboard.configured) missing.push(`${dashboard.label} dashboard ID`);
  }
  return missing;
}

export function metabaseStatusSummary(status) {
  if (!status) return '';
  const missing = missingMetabaseSettings(status);
  if (status.ready && missing.length === 0) {
    return 'Embedding is configured. Dashboards can be signed and embedded.';
  }
  return `Embedding is not ready. Missing: ${missing.join(', ')}.`;
}
