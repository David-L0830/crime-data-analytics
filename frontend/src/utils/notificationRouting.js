// Where a notification leads when it is clicked.
//
// This lives on its own because TWO surfaces act on it — the bell's dropdown
// panel (Header.jsx) and the arrival pop-up (MainLayout.jsx). When the rules
// lived inside Header, the pop-up had no way to route at all; duplicating them
// would have let the two drift, so that clicking the same notification in the
// panel and in the pop-up could land somewhere different.
//
// Returns a react-router target ({ path, state }) or null when a notification
// has nowhere meaningful to go — the caller still marks it read either way, so
// an unrecognised notification is never a dead click.

// Matches the case-number shape this system issues ("CN-2025-0032") without
// pinning the CN prefix: the prefix is data, not a rule, and a notification
// naming a differently-prefixed case must still route to that case rather than
// silently dropping to an unfiltered feed.
const CASE_NUMBER_PATTERN = /\b[A-Z]{2,5}-\d{4}-\d+\b/;

export function notificationTarget(notification) {
  if (!notification) return null;

  const { title, message } = notification;

  if (title === 'Hotspot Alert') {
    return { path: '/trends', state: { openHotspots: true } };
  }

  if (
    title === 'New Incident' ||
    title === 'Case Resolved' ||
    title === 'Overdue Case'
  ) {
    const caseMatch = (message || '').match(CASE_NUMBER_PATTERN);
    return {
      path: '/incident-feed',
      state: caseMatch ? { search: caseMatch[0] } : undefined,
    };
  }

  if (title === 'New Criminal Record') {
    return { path: '/criminal-records/criminal', state: undefined };
  }

  if (title === 'New Victim Record') {
    return { path: '/criminal-records/victim', state: undefined };
  }

  if (title === 'Sync Complete' || title === 'Backup Reminder') {
    return { path: '/settings', state: undefined };
  }

  return null;
}
