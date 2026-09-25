// Records sidebar group — which entry a URL belongs to.
//
// "Records" is a navigation GROUP in the sidebar (see Sidebar.jsx), not a page.
// Its two destinations own more URLs than their list routes: a criminal
// profile lives at /criminal-records/:id and a victim profile at
// /criminal-records/victims/:id (see AppRoutes.jsx). Plain NavLink matching
// would leave both children unhighlighted on a profile page, so the mapping
// is spelled out here, once, and tested.

export const RECORDS_BASE = '/criminal-records';
export const CRIMINAL_RECORDS_PATH = '/criminal-records/criminal';
export const VICTIM_RECORDS_PATH = '/criminal-records/victim';

export const RECORDS_SUBITEMS = [
  { key: 'criminal', to: CRIMINAL_RECORDS_PATH, label: 'Criminal Records' },
  { key: 'victim', to: VICTIM_RECORDS_PATH, label: 'Victim Records' },
];

/**
 * 'criminal' | 'victim' for a path inside the Records group, or null when the
 * path is outside it (or is the bare /criminal-records, which only redirects).
 */
export function activeRecordsItem(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '');
  if (!path.startsWith(`${RECORDS_BASE}/`)) return null;

  const rest = path.slice(RECORDS_BASE.length + 1);
  const [first] = rest.split('/');
  if (first === 'victim' || first === 'victims') return 'victim';
  if (first) return 'criminal';
  return null;
}

export function isRecordsPath(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '');
  return path === RECORDS_BASE || path.startsWith(`${RECORDS_BASE}/`);
}
