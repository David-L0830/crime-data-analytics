import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PAGE_TITLES } from '../../utils/constants';
import { useTheme } from '../../hooks/useTheme';
import { useData } from '../../hooks/useData';
import { useToast } from '../../hooks/useToast';
import { Icons } from '../icons';
import { notificationTarget } from '../../utils/notificationRouting';
import { relativeTime } from '../../utils/helpers';

export default function Header({ onMenuToggle, bellPulse = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const {
    notifications,
    secondaryLoading,
    markNotificationRead,
    markAllNotificationsRead,
    unreadNotificationCount,
  } = useData();
  const { showToast } = useToast();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const wrapperRef = useRef(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);

  const handleMarkAllRead = async () => {
    if (markingAllRead) return;
    setMarkingAllRead(true);
    try {
      await markAllNotificationsRead();
    } catch {
      showToast(
        'Could not mark notifications as read. Check your connection and try again.',
        'error',
      );
    } finally {
      setMarkingAllRead(false);
    }
  };

  // Try the two-segment key first (e.g. 'criminal-records/criminal'), then
  // fall back to the first path segment (e.g. 'criminal-records') so detail
  // routes like /criminal-records/:id still resolve to a real title instead
  // of silently falling through to 'Dashboard'.
  const segments = location.pathname.split('/').filter(Boolean);
  const moduleId = segments[0] || 'dashboard';
  const title =
    PAGE_TITLES[segments.slice(0, 2).join('/')] ||
    PAGE_TITLES[moduleId] ||
    'Dashboard';

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target))
        setDropdownOpen(false);
    };
    document.addEventListener('click', onClickOutside);
    return () => document.removeEventListener('click', onClickOutside);
  }, []);

  const currentDate = new Date().toLocaleDateString('en-PH', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Every notification is expected to lead somewhere — mark it read, close
  // the dropdown, then route.
  //
  // The routing RULES live in utils/notificationRouting so the arrival pop-up
  // (MainLayout) applies exactly the same ones; clicking a notification in the
  // panel and clicking it in the pop-up must not land in different places.
  // A notification with no known destination is still marked read and still
  // closes the panel, so it is never a dead click.
  //
  // Marking read is per-user: it clears the notification for THIS account
  // only, and the count below is this account's own unread total (see the
  // notification_reads table on the backend).
  const handleNotificationClick = (n) => {
    markNotificationRead(n.id);
    setDropdownOpen(false);

    const target = notificationTarget(n);
    if (target) {
      navigate(target.path, target.state ? { state: target.state } : undefined);
    }
  };

  const handleNotificationKeyDown = (e, n) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleNotificationClick(n);
    }
  };

  return (
    <header className="topbar">
      <button
        className="menu-toggle"
        onClick={onMenuToggle}
        aria-label="Toggle sidebar"
      >
        <Icons.Menu size={19} strokeWidth={2} />
      </button>
      <h1>{title}</h1>
      <div className="topbar-actions">
        <div className="notif-bell-wrapper" ref={wrapperRef}>
          <button
            className={`notif-bell-btn ${bellPulse ? 'pulsing' : ''}`}
            title="Notifications"
            aria-label={
              unreadNotificationCount
                ? `Notifications, ${unreadNotificationCount} unread`
                : 'Notifications'
            }
            aria-expanded={dropdownOpen}
            onClick={(e) => {
              e.stopPropagation();
              setDropdownOpen((o) => !o);
            }}
          >
            <Icons.Bell size={18} strokeWidth={2} />
            <span
              className={`notif-bell-count ${unreadNotificationCount ? '' : 'hidden'}`}
            >
              {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
            </span>
          </button>
          <div className={`notif-dropdown ${dropdownOpen ? '' : 'hidden'}`}>
            <div className="notif-dropdown-header">
              <span>Notifications</span>
              <button
                className="btn btn-sm btn-ghost"
                onClick={handleMarkAllRead}
                disabled={markingAllRead}
              >
                {markingAllRead ? 'Marking…' : 'Mark all read'}
              </button>
            </div>
            <div className="notif-dropdown-list">
              {/* "No notifications" is a statement of fact about the inbox, so
                  it must not be shown while the request that would populate it
                  is still in flight (see DataContext's secondary load wave). */}
              {notifications.length === 0 && (
                <div className="notif-dropdown-item">
                  {secondaryLoading
                    ? 'Loading notifications…'
                    : 'No notifications'}
                </div>
              )}
              {notifications.map((n) => {
                const NotifIcon =
                  n.type === 'success'
                    ? Icons.CheckCircle2
                    : n.type === 'warning'
                      ? Icons.AlertTriangle
                      : Icons.Info;
                return (
                  <div
                    key={n.id}
                    className={`notif-dropdown-item ${n.read ? '' : 'unread'}`}
                    onClick={() => handleNotificationClick(n)}
                    onKeyDown={(e) => handleNotificationKeyDown(e, n)}
                    role="button"
                    tabIndex={0}
                    aria-label={`${n.title}: ${n.message}`}
                  >
                    <span className="notif-dropdown-icon">
                      <NotifIcon size={16} strokeWidth={2} />
                    </span>
                    <div>
                      <div className="notif-dropdown-title">{n.title}</div>
                      <div className="notif-dropdown-msg">{n.message}</div>
                      {/* Relative age is what makes a notification list
                          scannable; the exact moment stays available on hover
                          via `title`, so nothing is lost. */}
                      <div
                        className="notif-dropdown-time"
                        title={new Date(n.timestamp).toLocaleString('en-PH')}
                      >
                        {relativeTime(n.timestamp)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <button
          className="theme-toggle"
          title="Toggle theme"
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <Icons.Sun size={17} strokeWidth={2} />
          ) : (
            <Icons.Moon size={17} strokeWidth={2} />
          )}
        </button>
        <span className="current-date">{currentDate}</span>
      </div>
    </header>
  );
}
