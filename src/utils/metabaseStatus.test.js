import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  metabaseStatusSummary,
  missingMetabaseSettings,
} from './metabaseStatus';

const ready = {
  siteUrl: 'https://metabase.example.org',
  siteUrlConfigured: true,
  embeddingSecretConfigured: true,
  tokenTtlSeconds: 600,
  ready: true,
  dashboards: [
    { key: 'crime', label: 'Crime Reporting Dashboard', id: '2', configured: true },
    { key: 'analytics', label: 'Statistical Analysis', id: '3', configured: true },
    { key: 'trends', label: 'Trend and Pattern Detection', id: '4', configured: true },
  ],
};

describe('Metabase status panel', () => {
  it('reports a fully configured deployment as ready', () => {
    expect(missingMetabaseSettings(ready)).toEqual([]);
    expect(metabaseStatusSummary(ready)).toMatch(/^Embedding is configured/);
  });

  it('names every missing value, in the order to fix them', () => {
    const broken = {
      ...ready,
      ready: false,
      siteUrl: null,
      siteUrlConfigured: false,
      embeddingSecretConfigured: false,
      dashboards: ready.dashboards.map((d) =>
        d.key === 'trends' ? { ...d, id: null, configured: false } : d,
      ),
    };

    expect(missingMetabaseSettings(broken)).toEqual([
      'Metabase site URL',
      'embedding secret key',
      'Trend and Pattern Detection dashboard ID',
    ]);
    expect(metabaseStatusSummary(broken)).toMatch(/^Embedding is not ready/);
  });

  it('offers nothing to edit and never renders a secret value', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const card = readFileSync(
      join(here, '..', 'components', 'settings', 'MetabaseStatusCard.jsx'),
      'utf8',
    );
    // Read-only: no inputs, and no field for a key value to arrive in.
    expect(card).not.toMatch(/<input|<textarea|<select/);
    expect(card).not.toMatch(/status\.(secret|secretKey|embeddingSecret)\b/);
  });
});
