import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { today } from '../utils/helpers';
import { SITIOS, CRIME_TYPES, CATEGORIES, STATUSES } from '../utils/constants';
import { AuthContext } from './AuthContext';
import { incidentService } from '../services/incidentService';
import { criminalService } from '../services/criminalService';
import { victimService } from '../services/victimService';
import { auditLogService } from '../services/auditLogService';
import { notificationService } from '../services/notificationService';
import { settingsService } from '../services/settingsService';
import { syncLogService } from '../services/syncLogService';
import { ApiError } from '../services/api';

export const DataContext = createContext(null);

const DEFAULT_SETTINGS = {
  barangay: 'Barangay 178',
  population: 15000,
  threshold: 5,
  hotspotThreshold: 3,
  categories: CATEGORIES,
};

// Converts the snake_case settings payload the Laravel API returns into the
// camelCase shape every page already expects (see Settings.jsx / Header.jsx).
function normalizeSettings(raw) {
  if (!raw) return DEFAULT_SETTINGS;
  return {
    barangay: raw.barangay ?? DEFAULT_SETTINGS.barangay,
    population: raw.population ?? DEFAULT_SETTINGS.population,
    threshold: raw.threshold ?? DEFAULT_SETTINGS.threshold,
    hotspotThreshold: raw.hotspot_threshold ?? raw.hotspotThreshold ?? DEFAULT_SETTINGS.hotspotThreshold,
    categories: raw.categories?.length ? raw.categories : DEFAULT_SETTINGS.categories,
  };
}

// This provider used to wrap an in-memory mock dataset. It now fetches every
// collection from the Laravel REST API on mount and calls the API for every
// write — the exposed useData() interface (records, criminals,
// validateRecord, updateRecord, ...) is unchanged so pages did
// not need to be rewritten.
// Checkpoint 28 — residents/addResident/updateResident/archiveResident
// removed along with the Resident Registry module (verified via grep: only
// Residents.jsx, now deleted, ever read `residents` or called those
// functions).
export function DataProvider({ children }) {
  const auth = useContext(AuthContext);
  const isAuthenticated = Boolean(auth?.currentUser);

  const [records, setRecords] = useState([]);
  const [criminals, setCriminals] = useState([]);
  const [victims, setVictims] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [syncLogs, setSyncLogs] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setRecords([]); setCriminals([]); setVictims([]); setAuditLogs([]);
      setNotifications([]); setSyncLogs([]); setSettings(DEFAULT_SETTINGS);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    // Checkpoint 18 — this used to be a single Promise.all(...). Some roles
    // (badac_readonly) are intentionally denied a subset of these endpoints
    // (GET /settings, GET /sync-logs — see routes/api.php) as part of their
    // normal, correct permissions, not as a failure. Promise.all rejects the
    // instant ANY one call rejects, so that one expected 403 was wiping out
    // every OTHER dataset the role legitimately has access to and showing a
    // blanket "Forbidden — insufficient role" banner over an otherwise-empty
    // dashboard. Promise.allSettled lets each resource succeed or fail on
    // its own: a role-restricted resource quietly falls back to its empty/
    // default value (exactly as if that role never had data there), while
    // every resource the role IS allowed to read still loads normally. A
    // genuine problem (backend down, network error) still surfaces via
    // `error` below — it's only 403 Forbidden that's treated as "this
    // role doesn't get this dataset" rather than "the whole page is broken".
    Promise.allSettled([
      incidentService.list(),
      criminalService.list(),
      victimService.list(),
      auditLogService.list(),
      notificationService.list(),
      syncLogService.list(),
      settingsService.get(),
    ]).then((results) => {
      if (cancelled) return;
      const [inc, crim, vict, logs, notifs, sync, settingsRaw] = results;
      const value = (r) => (r.status === 'fulfilled' ? r.value : undefined);

      setRecords(value(inc) || []);
      setCriminals(value(crim) || []);
      setVictims(value(vict) || []);
      setAuditLogs(value(logs) || []);
      setNotifications(value(notifs) || []);
      setSyncLogs(value(sync) || []);
      setSettings(normalizeSettings(value(settingsRaw)));

      // A 401 here (unauthenticated) means the session that got
      // currentUser set is no longer good enough for protected data —
      // expired, or otherwise invalidated. This is not "the server is
      // unreachable" and it is not something an error banner alone can
      // recover from: the person needs to be sent back through a real
      // login, not left staring at a dashboard that will 401 on every
      // request. See MainLayout.jsx / api.js for how each case is now
      // distinguished. (mfa_required is checked too for backward
      // compatibility with any cached/older API response shape, but the
      // backend no longer issues it — two-factor authentication has been
      // removed from this app; see AuthContext.jsx.)
      const authFailure = results.find(
        (r) =>
          r.status === 'rejected' &&
          r.reason instanceof ApiError &&
          (r.reason.type === 'mfa_required' || r.reason.type === 'unauthenticated')
      );
      if (authFailure) {
        const message =
          authFailure.reason.type === 'mfa_required'
            ? 'Second-factor verification required. Please complete MFA sign-in to continue.'
            : 'Your session has expired. Please sign in again.';
        auth.signOutDueToSessionIssue(message);
        setLoading(false);
        return;
      }

      // Only surface an error banner for a rejection that ISN'T an
      // expected "this role can't see this resource" 403 (role-restricted
      // resources are expected to fail this way for some roles — see
      // Checkpoint 18 note above) and isn't one of the auth failures
      // already handled above. What's left here is a genuine problem:
      // the backend unreachable, a 500, or similar.
      const genuineFailure = results.find(
        (r) => r.status === 'rejected' && !(r.reason instanceof ApiError && r.reason.status === 403)
      );
      if (genuineFailure) {
        setError(
          genuineFailure.reason instanceof ApiError
            ? { type: genuineFailure.reason.type, message: genuineFailure.reason.message }
            : { type: 'unknown', message: 'Unable to load data from the server.' }
        );
      }

      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const refreshAuditLogs = useCallback(() => {
    auditLogService.list().then(setAuditLogs).catch(() => {});
  }, []);

  // Local audit-log entries are no longer created client-side — every
  // mutating API call already writes its own audit_logs row server-side.
  // This just re-pulls the log list so the Audit Logs page reflects it.
  const addAuditLog = useCallback(() => {
    refreshAuditLogs();
  }, [refreshAuditLogs]);

  // ===== Incidents =====
  const isDuplicateCaseNumber = useCallback(
    (caseNumber, excludeId) =>
      records.some((r) => r.caseNumber.toLowerCase() === caseNumber.toLowerCase() && r.id !== excludeId),
    [records]
  );

  const validateRecord = useCallback(
    (data, excludeId) => {
      const errors = [];
      if (!data.caseNumber?.trim()) errors.push('Case number is required.');
      if (!data.crimeType) errors.push('Crime type is required.');
      if (!data.date) errors.push('Date is required.');
      if (!data.sitio) errors.push('Sitio is required.');
      if (data.caseNumber && isDuplicateCaseNumber(data.caseNumber.trim(), excludeId)) {
        errors.push('Case number already exists.');
      }
      return errors;
    },
    [isDuplicateCaseNumber]
  );

  const updateRecord = useCallback(async (id, data) => {
    const updated = await incidentService.update(id, data);
    setRecords((prev) => prev.map((r) => (r.id === id ? updated : r)));
    refreshAuditLogs();
  }, [refreshAuditLogs]);

  const addRecord = useCallback(async (data) => {
    const created = await incidentService.create(data);
    setRecords((prev) => [created, ...prev]);
    refreshAuditLogs();
    return created;
  }, [refreshAuditLogs]);

  // Checkpoint 20 — replaces deleteRecord(). Archive is persistent: the
  // incident stays in `records` with status 'Archived' (list pages filter
  // it out of the default view themselves) instead of being removed from
  // state, matching the backend's new behavior of updating the row rather
  // than deleting it.
  const archiveRecord = useCallback(async (id) => {
    const updated = await incidentService.archive(id);
    setRecords((prev) => prev.map((r) => (r.id === id ? updated : r)));
    refreshAuditLogs();
  }, [refreshAuditLogs]);

  // ===== Victims =====
  // Checkpoint 20 — new. No page currently calls this (VictimRecords.jsx /
  // VictimProfile.jsx have no delete/archive button today), but it's
  // exposed here so that UI can be added later without touching
  // DataContext again.
  const archiveVictim = useCallback(async (id) => {
    const updated = await victimService.archive(id);
    setVictims((prev) => prev.map((v) => (v.id === id ? updated : v)));
    refreshAuditLogs();
  }, [refreshAuditLogs]);

  // ===== Notifications =====
  const markNotificationRead = useCallback(async (id) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await notificationService.markRead(id);
    } catch {
      /* optimistic update already applied; a background refresh will reconcile */
    }
  }, []);

  // title is optional — when given, only notifications with that exact title
  // are marked read (used by the Hotspots panel's "Mark All as Read", which
  // should only affect Hotspot Alert notifications, not the whole inbox).
  // Unlike markNotificationRead above, this rethrows on failure instead of
  // swallowing it: the Hotspots button needs to know when the request
  // failed so it can revert its optimistic update and tell the user, rather
  // than silently claiming success.
  const markAllNotificationsRead = useCallback(async (title) => {
    let previous;
    setNotifications((prev) => {
      previous = prev;
      return prev.map((n) => (!title || n.title === title ? { ...n, read: true } : n));
    });
    try {
      await notificationService.markAllRead(title);
    } catch (err) {
      setNotifications(previous);
      throw err;
    }
  }, []);

  const unreadNotificationCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);
  const unreadHotspotAlertCount = useMemo(
    () => notifications.filter((n) => n.title === 'Hotspot Alert' && !n.read).length,
    [notifications]
  );

  // ===== Settings =====
  const saveSettings = useCallback(async (next) => {
    const payload = {
      barangay: next.barangay,
      population: next.population,
      threshold: next.threshold,
      hotspotThreshold: next.hotspotThreshold,
      categories: next.categories,
    };
    const raw = await settingsService.update(payload);
    setSettings(normalizeSettings(raw));
    refreshAuditLogs();
  }, [refreshAuditLogs]);

  // ===== Sync-derived helpers (mirrors original DataStore) =====
  const getLastSync = useCallback(
    () => syncLogs.find((l) => l.status === 'completed') || null,
    [syncLogs]
  );
  const sumImported = useCallback(
    (sinceMs) =>
      syncLogs
        .filter((l) => l.status === 'completed' && new Date(l.timestamp).getTime() >= sinceMs)
        .reduce((sum, l) => sum + (l.recordsReceived || 0), 0),
    [syncLogs]
  );
  const getTodayImportedCount = useCallback(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return sumImported(d.getTime());
  }, [sumImported]);
  const getThisMonthImportedCount = useCallback(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
    return sumImported(d.getTime());
  }, [sumImported]);

  // Checkpoint 28 — `residents` dropped from both the backup snapshot and
  // its dependency array; the Resident Registry module (and the
  // `residents` state above) no longer exists.
  const backup = useCallback(
    () =>
      JSON.stringify(
        { records, criminals, victims, settings, auditLogs, notifications, syncLogs, exportedAt: new Date().toISOString() },
        null,
        2
      ),
    [records, criminals, victims, settings, auditLogs, notifications, syncLogs]
  );

  const value = {
    records, criminals, victims, auditLogs, notifications, syncLogs, settings,
    loading, error,
    SITIOS, CRIME_TYPES, CATEGORIES: settings.categories?.length ? settings.categories : CATEGORIES, STATUSES,
    validateRecord, updateRecord, archiveRecord, addRecord,
    archiveVictim, archiveCriminal,
    markNotificationRead, markAllNotificationsRead, unreadNotificationCount, unreadHotspotAlertCount,
    saveSettings,
    getLastSync, getTodayImportedCount, getThisMonthImportedCount,
    backup, addAuditLog, today,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
