import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PAGE_TITLES } from '../../utils/constants';
import { useTheme } from '../../hooks/useTheme';
import { useData } from '../../hooks/useData';
import { useToast } from '../../hooks/useToast';
import { Icons } from '../icons';

export default function Header({ onMenuToggle }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { notifications, markNotificationRead, markAllNotificationsRead, unreadNotificationCount } = useData();
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
      showToast('Could not mark notifications as read. Check your connection and try again.', 'error');
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
  const title = PAGE_TITLES[segments.slice(0, 2).join('/')] || PAGE_TITLES[moduleId] || 'Dashboard';

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setDropdownOpen(false);
    };
    document.addEventListener('click', onClickOutside);
    return () => document.removeEventListener('click', onClickOutside);
  }, []);

  const currentDate = new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Every notification is expected to lead somewhere — mark it read, close
  // the dropdown, then route based on what it's about:
  //  - Hotspot Alert          -> Trends module, Hotspots panel opened
  //  - New Incident/Case      -> Incident Feed, pre-filtered to the case
  //    Resolved/Overdue Case     number mentioned in the message if we can
  //                              find one (e.g. "Case CN-2025-0032 ..."),
  //                              otherwise just the feed itself
  //  - Sync Complete/Backup    -> Settings (Data Backup & Restore section)
  //    Reminder
  // Anything we don't recognize still gets read/closed instead of doing
  // nothing, since a notification that goes nowhere isn't functional.
  const handleNotificationClick = (n) => {
    markNotificationRead(n.id);
    setDropdownOpen(false);

    if (n.title === 'Hotspot Alert') {
      navigate('/trends', { state: { openHotspots: true } });
      return;
    }

    if (n.title === 'New Incident' || n.title === 'Case Resolved' || n.title === 'Overdue Case') {
      const caseMatch = n.message.match(/\bCN-\d{4}-\d+\b/);
      navigate('/incident-feed', caseMatch ? { state: { search: caseMatch[0] } } : undefined);
      return;
    }

    if (n.title === 'Sync Complete' || n.title === 'Backup Reminder') {
      navigate('/settings');
      return;
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
      <button className="menu-toggle" onClick={onMenuToggle} aria-label="Toggle sidebar">
        <Icons.Menu size={19} strokeWidth={2} />
      </button>
      <h1>{title}</h1>
      <div className="topbar-actions">
        <div className="notif-bell-wrapper" ref={wrapperRef}>
          <button className="notif-bell-btn" title="Notifications" onClick={(e) => { e.stopPropagation(); setDropdownOpen((o) => !o); }}>
            <Icons.Bell size={18} strokeWidth={2} />
            <span className={`notif-bell-count ${unreadNotificationCount ? '' : 'hidden'}`}>
              {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
            </span>
          </button>
          <div className={`notif-dropdown ${dropdownOpen ? '' : 'hidden'}`}>
            <div className="notif-dropdown-header">
              <span>Notifications</span>
              <button className="btn btn-sm btn-ghost" onClick={handleMarkAllRead} disabled={markingAllRead}>
                {markingAllRead ? 'Marking…' : 'Mark all read'}
              </button>
            </div>
            <div className="notif-dropdown-list">
              {notifications.length === 0 && <div className="notif-dropdown-item">No notifications</div>}
              {notifications.map((n) => {
                const NotifIcon = n.type === 'success' ? Icons.CheckCircle2 : n.type === 'warning' ? Icons.AlertTriangle : Icons.Info;
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
                      <div className="notif-dropdown-time">{new Date(n.timestamp).toLocaleString('en-PH')}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <button className="theme-toggle" title="Toggle theme" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === 'dark' ? <Icons.Sun size={17} strokeWidth={2} /> : <Icons.Moon size={17} strokeWidth={2} />}
        </button>
        <span className="current-date">{currentDate}</span>
      </div>
    </header>
  );
}
