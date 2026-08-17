// Shared constants mirroring the original CDARS data model.
// Centralized here so backend integration later only needs to change /src/utils/mockData.js
// and the DataContext data-fetching functions — components consume these same shapes.

export const SITIOS = ['Sitio 1', 'Sitio 2', 'Sitio 3', 'Sitio 4', 'Sitio 5', 'Sitio 6', 'Sitio 7'];

export const STREETS = {
  'Sitio 1': ['Mabuhay St.', 'Kalayaan St.', 'Pascua St.', 'San Jose St.', 'Rizal St.'],
  'Sitio 2': ['Bonifacio St.', 'Luna St.', 'Jacinto St.', 'Mabini St.', 'Del Pilar St.'],
  'Sitio 3': ['Aguinaldo St.', 'Tupas St.', 'Sandoval St.', 'Cruz St.', 'Santos St.'],
  'Sitio 4': ['Gomez St.', 'Burgos St.', 'Zamora St.', 'Reyes St.', 'Tolentino St.'],
  'Sitio 5': ['Lapu-Lapu St.', 'Magellan St.', 'Legazpi St.', 'Rajah St.', 'Datu St.'],
  'Sitio 6': ['Malvar St.', 'Makahiya St.', 'Sampaguita St.', 'Rosal St.', 'Ilang-Ilang St.'],
  'Sitio 7': ['Narra St.', 'Mahogany St.', 'Acacia St.', 'Molave St.', 'Kamagong St.'],
};

export const CRIME_TYPES = [
  'Theft', 'Robbery', 'Assault', 'Homicide', 'Murder', 'Drug Offense',
  'Fraud', 'Vandalism', 'Cybercrime', 'Domestic Violence', 'Physical Injury', 'Carnapping',
];

export const CATEGORIES = ['Property Crime', 'Violent Crime', 'Drug-Related', 'Financial Crime', 'Cybercrime', 'Public Order'];

export const TYPE_CATEGORY_MAP = {
  Theft: 'Property Crime', Robbery: 'Property Crime', Vandalism: 'Property Crime', Carnapping: 'Property Crime',
  Assault: 'Violent Crime', Homicide: 'Violent Crime', Murder: 'Violent Crime', Kidnapping: 'Violent Crime',
  'Domestic Violence': 'Violent Crime', 'Physical Injury': 'Violent Crime',
  'Drug Offense': 'Drug-Related', Fraud: 'Financial Crime', Cybercrime: 'Cybercrime',
};

export const STATUSES = ['Open', 'Under Investigation', 'Solved', 'Closed', 'Archived'];
export const CRIMINAL_STATUSES = ['Active', 'Wanted', 'Incarcerated', 'Released', 'Deceased'];
export const RESIDENT_STATUSES = ['Active', 'Inactive', 'Deceased', 'Transferred', 'Archived'];
export const VICTIM_STATUSES = ['Active', 'Archived'];

export const OFFICERS = ['PO1 Santos', 'PO2 Reyes', 'PO3 Cruz', 'SPO1 Garcia', 'SPO2 Mendoza', 'Insp. Torres'];

export const BARANGAY_178_CENTER = { lat: 14.7323, lng: 121.0270 };

export const COLORS = {
  black: '#22291F',
  orange: '#FF8A3D',
  green: '#2E8B47',
  red: '#C0392B',
  gray: '#EAF6EC',
  white: '#FFFFFF',
  greenLight: 'rgba(46, 139, 71, 0.15)',
  orangeLight: 'rgba(255, 138, 61, 0.15)',
  chartPalette: ['#2E8B47', '#FF8A3D', '#0EA5E9', '#C0392B'],
  statusPalette: ['#2E8B47', '#FF8A3D', '#C0392B', '#94A3B8', '#0EA5E9'],
};

// Three account types: Administrator (full access), Encoder (restricted to
// the Crime Data Collection Module), and BADAC (read-only). Kept as a map
// (rather than a single hardcoded object) so ProtectedRoute/hasAccess/can
// keep working unchanged against whatever role string the backend returns —
// see backend app/Models/User.php for the matching server-side role constants.
export const ROLES = {
  badac_admin: {
    label: 'Administrator',
    // Checkpoint 28 — 'residents' removed (Resident Registry module
    // removed) and 'security' removed (Security sidebar section removed;
    // its Two-Factor Authentication content now lives under
    // 'user-management', which badac_admin already had).
    modules: ['dashboard', 'incident-feed', 'mapping', 'analytics', 'trends', 'criminal-records', 'audit-logs', 'user-management', 'settings'],
  },
  encoder: {
    label: 'Encoder',
    // Checkpoint 28 — 'security' replaced with 'user-management' so Encoder
    // keeps the exact same self-service 2FA access it always had (now
    // reached via User Management, which conditionally shows only the
    // self-service 2FA section for a non-admin role — see UserManagement.jsx).
    // Encoder still cannot list/edit other accounts: that stays gated by
    // the backend's role:badac_admin middleware on GET/PUT /users*.
    modules: ['incident-feed', 'user-management'],
  },
  // Read-only BADAC viewer account (username "Badac", display name "Gilbert
  // Franco") — full view access from the Crime Reporting Dashboard through
  // Records, but no Audit Logs (Checkpoint 38 — BADAC users must not have
  // Audit Logs access; previously badac_readonly had full/unscoped audit-log
  // visibility, that is intentionally revoked here), no User Management/
  // Settings (account administration stays badac_admin-only), and per
  // PERMISSIONS below, no create/edit/delete capability anywhere. The
  // backend enforces the same restriction independently — see
  // GET /audit-logs in backend/routes/api.php — this list only controls
  // what the UI shows.
  badac_readonly: {
    label: 'BADAC',
    // Checkpoint 28 — 'residents' removed (Resident Registry module
    // removed). badac_readonly never had 'security'/2FA access before this
    // checkpoint and still doesn't (unaffected by the Security→User
    // Management move). Checkpoint 38 — 'audit-logs' removed.
    modules: ['dashboard', 'incident-feed', 'mapping', 'analytics', 'trends', 'criminal-records'],
  },
};

// Checkpoint 20 — delete_record / delete_own_incident renamed to
// archive_record / archive_own_incident (Task 3). These are frontend-only
// UI-gating constants (no backend Policy class or database column holds
// the old string), so this is a clean rename with no compatibility shim
// needed. Real enforcement is unchanged: IncidentController::archive()'s
// server-side ownership check and the role: middleware in routes/api.php.
export const PERMISSIONS = {
  badac_admin: ['edit_any_record', 'archive_record', 'view_audit_logs', 'manage_settings'],
  // badac_readonly intentionally has no entries here: view access is granted
  // entirely through ROLES.badac_readonly.modules above, and can() returns
  // false for every mutation permission (create_incident, edit_any_record,
  // edit_own_incident, archive_record, archive_own_incident, manage_settings)
  // since none of them are listed for this role.
  badac_readonly: [],
  // Encoder may archive incidents they personally encoded (mirrors
  // edit_own_incident) — server-side ownership check lives in
  // IncidentController::archive(), this permission only controls whether
  // the Archive action is shown at all.
  encoder: ['create_incident', 'edit_own_incident', 'archive_own_incident'],
};

// icon keys map to lucide-react components — see ICONS in components/icons.jsx
// `section` groups items under a header in the sidebar (see Sidebar.jsx) —
// purely a visual grouping key, does not affect routing or RBAC.
export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Crime Reporting Dashboard', icon: 'dashboard', section: 'overview' },
  { id: 'incident-feed', label: 'Crime Data Collection', icon: 'incidents', section: 'crime-management' },
  // Checkpoint 28 — Resident Registry module removed entirely.
  // Task 3/2 (Checkpoint 19): sidebar label changed from "Criminal Records"
  // to "Records" — the id/moduleId stays 'criminal-records' on purpose so
  // RBAC (ROLES[].modules, hasAccess, backend role checks) is untouched.
  // Clicking it now lands on the Records module (pages/Records.jsx), which
  // offers "Criminal Record" and "Victim Record" as the two sub-choices.
  { id: 'criminal-records', label: 'Records', icon: 'criminalRecords', section: 'crime-management' },
  { id: 'mapping', label: 'Crime Mapping and Visualization', icon: 'mapping', section: 'analytics' },
  { id: 'analytics', label: 'Statistical Analysis', icon: 'analytics', section: 'analytics' },
  { id: 'trends', label: 'Trend and Pattern Detection', icon: 'trends', section: 'analytics' },
  { id: 'audit-logs', label: 'Audit Logs', icon: 'auditLogs', section: 'administration' },
  // Checkpoint 28 — the standalone 'Security' sidebar entry is removed.
  // Two-Factor Authentication (Phase 4 — Feature #4) now lives inside
  // User Management for both roles that used to see Security (badac_admin,
  // encoder) — see ROLES above and UserManagement.jsx.
  { id: 'user-management', label: 'User Management', icon: 'userManagement', section: 'administration' },
  // System Settings intentionally has no sidebar entry (Part C-11 of the design
  // spec) — the route below still exists for BADAC Administrator's authorized
  // use, it's just not a nav item.
];

export const NAV_SECTION_LABELS = {
  overview: 'Overview',
  'crime-management': 'Crime Management',
  analytics: 'Analytics',
  administration: 'Administration',
};

// Kept in sync with NAV_ITEMS labels (minus "Module") so the topbar title
// matches the sidebar entry the user just clicked.
export const PAGE_TITLES = {
  dashboard: 'Crime Reporting Dashboard',
  'incident-feed': 'Crime Data Collection',
  mapping: 'Crime Mapping and Visualization',
  analytics: 'Statistical Analysis',
  trends: 'Trend and Pattern Detection',
  'criminal-records': 'Records',
  'criminal-records/criminal': 'Criminal Records',
  'criminal-records/victim': 'Victim Records',
  'audit-logs': 'Audit Logs',
  'user-management': 'User Management',
  settings: 'System Settings',
};

// The first module in a role's allowed list is that role's landing page —
// used for the post-login redirect and for bouncing a user off a route
// their role can't access (see ProtectedRoute.jsx / AppRoutes.jsx / Login.jsx).
export function defaultRouteForRole(roleKey) {
  const mod = ROLES[roleKey]?.modules?.[0];
  return mod ? `/${mod}` : '/login';
}
