import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { today } from '../utils/helpers';
import { SITIOS, CRIME_TYPES, CATEGORIES, STATUSES } from '../utils/constants';
import { AuthContext } from './AuthContext';
import { incidentService } from '../services/incidentService';
import { criminalService } from '../services/criminalService';
import { victimService } from '../services/victimService';
import { auditLogService } from '../services/auditLogService';
import { notificationService } from '../services/notificationService';
import { settingsService } from '../services/settingsService';
import { crimeTypeService } from '../services/crimeTypeService';
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
    hotspotThreshold:
      raw.hotspot_threshold ??
      raw.hotspotThreshold ??
      DEFAULT_SETTINGS.hotspotThreshold,
    categories: raw.categories?.length
      ? raw.categories
      : DEFAULT_SETTINGS.categories,
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
  // Configurable crime types and their map colours, loaded from the API (see
  // backend CrimeTypeController). This is what makes the Crime Mapping legend,
  // the incident form's Crime Type list and every crime-type filter follow
  // what an Administrator configured in System Settings, instead of a
  // hard-coded array in constants.js.
  const [crimeTypes, setCrimeTypes] = useState([]);
  const [syncLogs, setSyncLogs] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  // Loading state for the SECONDARY wave (audit logs, notifications, sync
  // logs). Deliberately separate from `loading`: those three datasets are not
  // needed to render the page a sign-in lands on, so they must not hold the
  // whole application behind a blank "Loading dashboard data..." screen. They
  // do still need a loading state of their own, or the screens that read them
  // would render a confident "No records found" for a request that simply
  // hasn't come back yet.
  const [secondaryLoading, setSecondaryLoading] = useState(true);
  const [error, setError] = useState(null);

  // Notifications that have arrived since this session started looking, and
  // have not yet been announced. MainLayout drains this and turns each one
  // into a pop-up, a chime and a top-edge pulse.
  const [newNotifications, setNewNotifications] = useState([]);
  // Every notification id this session has already seen. An id enters this set
  // the first time it appears in a fetch, INCLUDING the very first fetch after
  // sign-in — which is why signing in does not fire a burst of pop-ups for the
  // backlog already sitting in the bell. It is also what guarantees the "only
  // once per notification" rule: an id can only ever be new once.
  const seenNotificationIds = useRef(new Set());
  // Whether the inbox has been read at least once this session. The FIRST
  // successful read is the backlog and is recorded silently; everything after
  // it can announce. Tracked as its own flag rather than inferred from an
  // empty seen-set, because an account whose inbox is genuinely empty would
  // otherwise treat its first real notification as backlog and stay silent.
  const notificationsSeeded = useRef(false);

  const consumeNewNotifications = useCallback(() => {
    setNewNotifications([]);
  }, []);

  // The one place a notification list from the API becomes state.
  //
  // Announcing is decided here rather than at each call site so the rule
  // cannot differ between the initial load, the poll, and the refresh that
  // follows a write: a notification is announced only if this session has
  // never seen its id AND the backlog has already been recorded AND it is
  // still unread. That conjunction is what makes "exactly once per
  // notification, never a burst on sign-in" hold no matter which path the list
  // arrived by.
  const applyNotificationList = useCallback((list) => {
    const items = list || [];
    const isFirstRead = !notificationsSeeded.current;

    const fresh = isFirstRead
      ? []
      : items.filter((n) => !seenNotificationIds.current.has(n.id) && !n.read);

    items.forEach((n) => seenNotificationIds.current.add(n.id));
    notificationsSeeded.current = true;

    setNotifications(items);
    if (fresh.length) {
      setNewNotifications((prev) => [...prev, ...fresh]);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setRecords([]);
      setCriminals([]);
      setVictims([]);
      setAuditLogs([]);
      setNotifications([]);
      setCrimeTypes([]);
      setSyncLogs([]);
      setSettings(DEFAULT_SETTINGS);
      // Signing out must forget what this session had seen, or signing back in
      // as a different person would suppress their pop-ups for notifications
      // the PREVIOUS account had already been shown.
      seenNotificationIds.current = new Set();
      notificationsSeeded.current = false;
      setNewNotifications([]);
      setLoading(false);
      setSecondaryLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setSecondaryLoading(true);
    setError(null);

    // Split into two waves so first paint is gated by the data the landing
    // page actually needs, not by the slowest of seven unrelated requests.
    //
    // PRIMARY   - incidents, criminals, victims, settings. Every route a
    //             sign-in can land on (Dashboard, Crime Data Collection,
    //             Records, Analytics, Trends, Mapping) reads these, and
    //             `settings` also supplies the category vocabulary and
    //             thresholds those pages filter and compute with, so
    //             rendering before it arrives would show figures computed
    //             against the wrong configuration.
    //             Sync logs are here too, not because a page is built on
    //             them, but because the Dashboard's "Today Imported" /
    //             "Month Imported" KPI cards are: deferring them would print
    //             a confident 0 on first paint and then change it.
    // SECONDARY - audit logs and notifications. Read only by the Audit Logs
    //             page and the topbar bell, both of which now show their own
    //             loading state instead of holding the whole application
    //             back, and neither of which is on the page a sign-in lands
    //             on.
    //
    // Both waves start in the same tick, so nothing is fetched later than it
    // used to be - only the gate moved.
    //
    // Checkpoint 18 - these used to be a single Promise.all(...). Some roles
    // (badac_readonly) are intentionally denied a subset of these endpoints
    // (GET /settings, GET /sync-logs - see routes/api.php) as part of their
    // normal, correct permissions, not as a failure. Promise.all rejects the
    // instant ANY one call rejects, so that one expected 403 was wiping out
    // every OTHER dataset the role legitimately has access to and showing a
    // blanket "Forbidden - insufficient role" banner over an otherwise-empty
    // dashboard. Promise.allSettled lets each resource succeed or fail on its
    // own: a role-restricted resource quietly falls back to its empty/default
    // value (exactly as if that role never had data there), while every
    // resource the role IS allowed to read still loads normally. A genuine
    // problem (backend down, network error) still surfaces via `error` below
    // - it's only 403 Forbidden that's treated as "this role doesn't get this
    // dataset" rather than "the whole page is broken".
    //
    // Returns true when the session turned out to be dead, so the caller can
    // stop waiting on anything else.
    // Both waves can independently observe the same dead session. Only the
    // first one acts on it: signOutDueToSessionIssue() posts a logout and
    // clears the user, and running it twice would fire a second, pointless
    // request and re-set the same message.
    let signOutIssued = false;

    const applyResults = (results, assign) => {
      results.forEach((r, i) => {
        assign[i](r.status === 'fulfilled' ? r.value : undefined);
      });

      // A 401 here (unauthenticated) means the session that got currentUser
      // set is no longer good enough for protected data - expired, or
      // otherwise invalidated. This is not "the server is unreachable" and it
      // is not something an error banner alone can recover from: the person
      // needs to be sent back through a real login, not left staring at a
      // dashboard that will 401 on every request. See MainLayout.jsx /
      // api.js for how each case is now distinguished.
      //
      // mfa_required is a real, currently-issued response again: the backend
      // returns it when an MFA-enrolled account's session is still only aal1
      // (see EnsureSupabaseAal2). Reaching it from here should be rare, since
      // AuthContext will not set currentUser for such a session in the first
      // place, so arriving here means the session's assurance level dropped
      // mid-visit. Signing out is the right response either way: the login
      // screen is where the TOTP challenge lives, so this routes the person
      // to it rather than leaving them on a page that can load nothing.
      const authFailure = results.find(
        (r) =>
          r.status === 'rejected' &&
          r.reason instanceof ApiError &&
          (r.reason.type === 'mfa_required' ||
            r.reason.type === 'unauthenticated'),
      );
      if (authFailure) {
        if (!signOutIssued) {
          signOutIssued = true;
          const message =
            authFailure.reason.type === 'mfa_required'
              ? 'Second-factor verification required. Please complete MFA sign-in to continue.'
              : 'Your session has expired. Please sign in again.';
          auth.signOutDueToSessionIssue(message);
        }
        return true;
      }

      // Only surface an error banner for a rejection that ISN'T an expected
      // "this role can't see this resource" 403 (role-restricted resources
      // are expected to fail this way for some roles - see the note above)
      // and isn't one of the auth failures already handled. What's left here
      // is a genuine problem: the backend unreachable, a 500, or similar.
      const genuineFailure = results.find(
        (r) =>
          r.status === 'rejected' &&
          !(r.reason instanceof ApiError && r.reason.status === 403),
      );
      if (genuineFailure) {
        setError(
          genuineFailure.reason instanceof ApiError
            ? {
                type: genuineFailure.reason.type,
                message: genuineFailure.reason.message,
              }
            : {
                type: 'unknown',
                message: 'Unable to load data from the server.',
              },
        );
      }
      return false;
    };

    Promise.allSettled([
      incidentService.list(),
      criminalService.list(),
      victimService.list(),
      settingsService.get(),
      syncLogService.list(),
      // Primary, not secondary: the Crime Type vocabulary and its colours are
      // read by the very first paint of Crime Data Collection (the form's
      // Crime Type list), every FilterBar, and Crime Mapping's markers and
      // legend. Deferring it would render those against a stale hard-coded
      // fallback and then change them.
      crimeTypeService.list(),
    ]).then((results) => {
      if (cancelled) return;
      const sessionDead = applyResults(results, [
        (v) => setRecords(v || []),
        (v) => setCriminals(v || []),
        (v) => setVictims(v || []),
        (v) => setSettings(normalizeSettings(v)),
        (v) => setSyncLogs(v || []),
        (v) => setCrimeTypes(v || []),
      ]);
      setLoading(false);
      if (sessionDead) setSecondaryLoading(false);
    });

    Promise.allSettled([
      auditLogService.list(),
      notificationService.list(),
    ]).then((results) => {
      if (cancelled) return;
      applyResults(results, [
        (v) => setAuditLogs(v || []),
        // First sight of the inbox: recorded, not announced — what is
        // already in the bell is history, not news. See
        // applyNotificationList.
        (v) => applyNotificationList(v),
      ]);
      setSecondaryLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const refreshAuditLogs = useCallback(() => {
    auditLogService
      .list()
      .then(setAuditLogs)
      .catch(() => {});
  }, []);

  // The server now writes a real notification when an incident is created or
  // genuinely transitions into a resolved status (see
  // IncidentController::announceResolutionIfNewlyResolved). The topbar bell
  // reads from this state, which is otherwise loaded once on mount, so
  // without re-pulling the list after such a write the notification would not
  // appear until the next full page load. Failures are swallowed on purpose:
  // the incident write itself already succeeded and has its own error
  // handling at the call site - a stale bell must never be reported to the
  // user as a failed save.
  const refreshNotifications = useCallback(() => {
    notificationService
      .list()
      .then(applyNotificationList)
      .catch(() => {});
  }, [applyNotificationList]);

  // Polls for notifications raised elsewhere — another encoder logging an
  // incident, an Administrator resolving a case. Without this the bell would
  // only ever change on a full page load or on this user's own writes.
  //
  // Paused while the tab is hidden (and refreshed once on becoming visible
  // again) so a backgrounded tab is not requesting on a timer all day; the
  // notification is still there when the person comes back, because the
  // announcement is a database row, not an event that can be missed.
  useEffect(() => {
    if (!isAuthenticated) return undefined;

    const POLL_MS = 30000;
    let timer = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') refreshNotifications();
      }, POLL_MS);
    };
    const stop = () => {
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshNotifications();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isAuthenticated, refreshNotifications]);

  // Local audit-log entries are no longer created client-side — every
  // mutating API call already writes its own audit_logs row server-side.
  // This just re-pulls the log list so the Audit Logs page reflects it.
  const addAuditLog = useCallback(() => {
    refreshAuditLogs();
  }, [refreshAuditLogs]);

  // ===== Incidents =====
  const isDuplicateCaseNumber = useCallback(
    (caseNumber, excludeId) =>
      records.some(
        (r) =>
          r.caseNumber.toLowerCase() === caseNumber.toLowerCase() &&
          r.id !== excludeId,
      ),
    [records],
  );

  const validateRecord = useCallback(
    (data, excludeId) => {
      const errors = [];
      if (!data.caseNumber?.trim()) errors.push('Case number is required.');
      if (!data.crimeType) errors.push('Crime type is required.');
      if (!data.date) errors.push('Date is required.');
      if (!data.sitio) errors.push('Sitio is required.');
      if (
        data.caseNumber &&
        isDuplicateCaseNumber(data.caseNumber.trim(), excludeId)
      ) {
        errors.push('Case number already exists.');
      }
      // Mirrors the server's required_if rule (see StoreIncidentRequest), so
      // the encoder is told in the form instead of by a 422 after submitting.
      // The server rule is the one that actually enforces it — this check only
      // saves a round trip.
      if (data.complainantIsVictim === false && !data.complainantName?.trim()) {
        errors.push(
          'Complainant full name is required when the complainant is not the victim.',
        );
      }
      return errors;
    },
    [isDuplicateCaseNumber],
  );

  const updateRecord = useCallback(
    async (id, data) => {
      const updated = await incidentService.update(id, data);
      // Replace in place, keyed by id. The response is the same row that was
      // just written, so the collection length is unchanged (no duplicate
      // record) and no other incident is touched.
      setRecords((prev) => prev.map((r) => (r.id === id ? updated : r)));
      refreshAuditLogs();
      refreshNotifications();
    },
    [refreshAuditLogs, refreshNotifications],
  );

  const addRecord = useCallback(
    async (data) => {
      const created = await incidentService.create(data);
      setRecords((prev) => [created, ...prev]);
      refreshAuditLogs();
      refreshNotifications();
      return created;
    },
    [refreshAuditLogs, refreshNotifications],
  );

  // Checkpoint 20 — replaces deleteRecord(). Archive is persistent: the
  // incident stays in `records` with status 'Archived' (list pages filter
  // it out of the default view themselves) instead of being removed from
  // state, matching the backend's new behavior of updating the row rather
  // than deleting it.
  const archiveRecord = useCallback(
    async (id) => {
      const updated = await incidentService.archive(id);
      setRecords((prev) => prev.map((r) => (r.id === id ? updated : r)));
      refreshAuditLogs();
    },
    [refreshAuditLogs],
  );

  // Inverse of archiveRecord, same shape as restoreVictim/restoreCriminal
  // below: the server decides the restored status from the row's own
  // previous_status, and the response replaces the record in state so the
  // list re-renders with it. No local status guessing.
  const restoreRecord = useCallback(
    async (id) => {
      const updated = await incidentService.restore(id);
      setRecords((prev) => prev.map((r) => (r.id === id ? updated : r)));
      refreshAuditLogs();
    },
    [refreshAuditLogs],
  );

  // ===== Victims =====
  // Checkpoint 20 — new. No page currently calls this (VictimRecords.jsx /
  // VictimProfile.jsx have no delete/archive button today), but it's
  // exposed here so that UI can be added later without touching
  // DataContext again.
  const archiveVictim = useCallback(
    async (id) => {
      const updated = await victimService.archive(id);
      setVictims((prev) => prev.map((v) => (v.id === id ? updated : v)));
      refreshAuditLogs();
    },
    [refreshAuditLogs],
  );

  // Inverse of archiveVictim, same shape: the server decides the restored
  // status from the row's own previous_status, and the response replaces the
  // record in state so the list re-renders with it. No local status guessing.
  const restoreVictim = useCallback(
    async (id) => {
      const updated = await victimService.restore(id);
      setVictims((prev) => prev.map((v) => (v.id === id ? updated : v)));
      refreshAuditLogs();
    },
    [refreshAuditLogs],
  );

  // ===== Criminals =====
  const archiveCriminal = useCallback(
    async (id) => {
      const updated = await criminalService.archive(id);
      setCriminals((prev) => prev.map((c) => (c.id === id ? updated : c)));
      refreshAuditLogs();
    },
    [refreshAuditLogs],
  );

  // Inverse of archiveCriminal — see restoreVictim above.
  const restoreCriminal = useCallback(
    async (id) => {
      const updated = await criminalService.restore(id);
      setCriminals((prev) => prev.map((c) => (c.id === id ? updated : c)));
      refreshAuditLogs();
    },
    [refreshAuditLogs],
  );

  // ===== Notifications =====
  // Read state is per-user server-side (see the notification_reads table), so
  // this marks the notification read for THIS account only and the unread
  // count that drops is this account's own.
  const markNotificationRead = useCallback(async (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
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
      return prev.map((n) =>
        !title || n.title === title ? { ...n, read: true } : n,
      );
    });
    try {
      await notificationService.markAllRead(title);
    } catch (err) {
      setNotifications(previous);
      throw err;
    }
  }, []);

  // Names only, enabled only — the vocabulary a user may pick from or filter
  // by. A disabled crime type stays in `crimeTypes` (existing incidents still
  // reference it and the map still has to colour them) but must not be
  // offered for new records.
  const activeCrimeTypeNames = useMemo(
    () => crimeTypes.filter((t) => t.isActive).map((t) => t.name),
    [crimeTypes],
  );

  // { 'Theft': '#EA580C', ... } — the one lookup the map, the legend and any
  // other crime-type-coloured surface share, so a colour cannot mean one thing
  // in the legend and another on the markers.
  const crimeTypeColors = useMemo(
    () => Object.fromEntries(crimeTypes.map((t) => [t.name, t.color])),
    [crimeTypes],
  );

  const unreadNotificationCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );
  const unreadHotspotAlertCount = useMemo(
    () =>
      notifications.filter((n) => n.title === 'Hotspot Alert' && !n.read)
        .length,
    [notifications],
  );

  // ===== Crime types =====
  // Only an Administrator can reach these (the API enforces it — see
  // routes/api.php); the Settings page is simply where the UI for them lives.
  const addCrimeType = useCallback(
    async (name) => {
      const created = await crimeTypeService.create({ name });
      setCrimeTypes((prev) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      refreshAuditLogs();
      return created;
    },
    [refreshAuditLogs],
  );

  const updateCrimeType = useCallback(
    async (id, patch) => {
      const updated = await crimeTypeService.update(id, patch);
      setCrimeTypes((prev) =>
        prev
          .map((t) => (t.id === id ? updated : t))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      refreshAuditLogs();
      return updated;
    },
    [refreshAuditLogs],
  );

  // ===== Settings =====
  const saveSettings = useCallback(
    async (next) => {
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
    },
    [refreshAuditLogs],
  );

  // ===== Sync-derived helpers (mirrors original DataStore) =====
  const getLastSync = useCallback(
    () => syncLogs.find((l) => l.status === 'completed') || null,
    [syncLogs],
  );

  // Checkpoint 28 — `residents` dropped from both the backup snapshot and
  // its dependency array; the Resident Registry module (and the
  // `residents` state above) no longer exists.
  const backup = useCallback(
    () =>
      JSON.stringify(
        {
          records,
          criminals,
          victims,
          settings,
          auditLogs,
          notifications,
          syncLogs,
          exportedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    [records, criminals, victims, settings, auditLogs, notifications, syncLogs],
  );

  const value = {
    records,
    criminals,
    victims,
    auditLogs,
    notifications,
    syncLogs,
    settings,
    loading,
    secondaryLoading,
    error,
    SITIOS,
    // The configured, ENABLED crime types drive every picker and filter in the
    // app. The hard-coded constant remains only as the fallback for the moment
    // before the list has loaded (or for a role whose request failed), so a
    // Crime Type dropdown is never empty.
    CRIME_TYPES: activeCrimeTypeNames.length
      ? activeCrimeTypeNames
      : CRIME_TYPES,
    CATEGORIES: settings.categories?.length ? settings.categories : CATEGORIES,
    STATUSES,
    // Full records, including disabled ones and every colour — what System
    // Settings manages and what the map legend reads.
    crimeTypes,
    crimeTypeColors,
    addCrimeType,
    updateCrimeType,
    validateRecord,
    updateRecord,
    archiveRecord,
    restoreRecord,
    addRecord,
    archiveVictim,
    restoreVictim,
    archiveCriminal,
    restoreCriminal,
    markNotificationRead,
    markAllNotificationsRead,
    unreadNotificationCount,
    unreadHotspotAlertCount,
    newNotifications,
    consumeNewNotifications,
    refreshNotifications,
    saveSettings,
    getLastSync,
    backup,
    addAuditLog,
    today,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
