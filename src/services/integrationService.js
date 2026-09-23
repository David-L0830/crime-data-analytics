import { api } from './api';

// BPA Level 2 outputs — read-only, pull-based snapshots of OFFICIAL incidents
// for the two sub-systems CDARS reports to. Super Administrator only (see
// IntegrationController and routes/api.php). Both responses keep their data
// under named keys rather than `data`, so api's unwrap() leaves them whole.
export const integrationService = {
  securityAlertHotspots: () =>
    api.get('/v1/integrations/security-alerts/hotspots'),
  campaignPlanningTrends: () =>
    api.get('/v1/integrations/campaign-planning/trends'),
};
