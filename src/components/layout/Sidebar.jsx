import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { NAV_ITEMS, NAV_SECTION_LABELS } from '../../utils/constants';
import { useAuth } from '../../hooks/useAuth';
import { NAV_ICONS, Icons } from '../icons';
import logo from '../../assets/images/barangay178-logo.png';
import ProfileSettingsModal from './ProfileSettingsModal';

// Checkpoint 19/25 — the Records nav item's id/moduleId is 'criminal-records'
// (see constants.js's own comment on NAV_ITEMS), but Checkpoint 25 adds a
// real sidebar submenu under it — Criminal Records / Victim Records — on
// top of the existing Records landing page at that same route, without
// touching AppRoutes.jsx's routing (all three routes already existed).
const RECORDS_ITEM_ID = 'criminal-records';
const RECORDS_SUBITEMS = [
  { to: '/criminal-records/criminal', label: 'Criminal Records' },
  { to: '/criminal-records/victim', label: 'Victim Records' },
];

export default function Sidebar({ open, collapsed, onNavigate }) {
  const { currentUser, role, hasAccess, logout, avatarSrc } = useAuth();
  const location = useLocation();
  const [recordsExpanded, setRecordsExpanded] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  // Checkpoint 39 (Task 9.3) — same broken-image fallback as
  // ProfileSettingsModal; see that file's comment for why.
  const [avatarBroken, setAvatarBroken] = useState(false);
  // Checkpoint 39 — collapsed-rail nav tooltip. Rendered as a sibling of
  // `.sidebar-nav` (not a descendant — see the `.sidebar-nav-tooltip` CSS
  // comment for why) and positioned from a live getBoundingClientRect()
  // read so it lines up with whichever nav-item is hovered, independent of
  // sidebar scroll position.
  const [hoveredNavTip, setHoveredNavTip] = useState(null); // { label, top }

  const showNavTip = (label) => (e) => {
    if (!collapsed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredNavTip({ label, top: rect.top + rect.height / 2 });
  };
  const hideNavTip = () => setHoveredNavTip(null);

  const onRecordsSubroute = RECORDS_SUBITEMS.some((s) =>
    location.pathname.startsWith(s.to),
  );

  // Auto-open the submenu when navigation (not a sidebar click) lands on a
  // Criminal/Victim Records sub-route, e.g. a deep link or the "view record"
  // links from other pages — otherwise the active sub-item would be hidden
  // inside a collapsed submenu.
  useEffect(() => {
    if (onRecordsSubroute) setRecordsExpanded(true);
  }, [onRecordsSubroute]);

  // Drop any lingering tooltip if the sidebar expands (its `top` was
  // computed from a rect that's no longer meaningful once collapsed
  // layout goes away) or the nav list scrolls (the hovered item has
  // moved, so a stale `top` would float in place instead of tracking it).
  useEffect(() => {
    if (!collapsed) setHoveredNavTip(null);
  }, [collapsed]);

  useEffect(() => {
    setAvatarBroken(false);
  }, [currentUser?.avatarUrl]);

  useEffect(() => {
    if (!accountMenuOpen) return undefined;
    const close = () => setAccountMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [accountMenuOpen]);

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-header">
        <img src={logo} alt="" className="brand-logo-img sidebar-logo" />
        <div className="brand-text">
          <h2>BADAC Analytics</h2>
          <span>Barangay 178, North Caloocan</span>
        </div>
      </div>

      <nav className="sidebar-nav" onScroll={hideNavTip}>
        {(() => {
          let lastSection = null;
          return NAV_ITEMS.filter(
            (item) =>
              hasAccess(item.id) &&
              !(
                currentUser?.role === 'encoder' && item.id === 'user-management'
              ),
          ).map((item) => {
            const NavIcon = NAV_ICONS[item.icon] || NAV_ICONS.dashboard;
            const isRecords = item.id === RECORDS_ITEM_ID;
            const showSectionLabel = !collapsed && item.section !== lastSection;
            lastSection = item.section;
            const sectionLabel = showSectionLabel ? (
              <div className="nav-section-label">
                {NAV_SECTION_LABELS[item.section]}
              </div>
            ) : null;

            if (!isRecords) {
              return (
                <div key={item.id}>
                  {sectionLabel}
                  <NavLink
                    to={`/${item.id}`}
                    className={({ isActive }) =>
                      `nav-item ${isActive ? 'active' : ''}`
                    }
                    onClick={onNavigate}
                    title={collapsed ? undefined : item.label}
                    aria-label={item.label}
                    onMouseEnter={showNavTip(item.label)}
                    onMouseLeave={hideNavTip}
                  >
                    <span className="nav-icon">
                      <NavIcon size={19} strokeWidth={2} />
                    </span>
                    <span className="nav-label">{item.label}</span>
                  </NavLink>
                </div>
              );
            }

            return (
              <div key={item.id}>
                {sectionLabel}
                <div className="nav-group">
                  <NavLink
                    to={`/${item.id}`}
                    end
                    className={({ isActive }) =>
                      `nav-item nav-item-parent ${isActive || onRecordsSubroute ? 'active' : ''}`
                    }
                    onClick={onNavigate}
                    title={collapsed ? undefined : item.label}
                    aria-label={item.label}
                    onMouseEnter={showNavTip(item.label)}
                    onMouseLeave={hideNavTip}
                  >
                    <span className="nav-icon">
                      <NavIcon size={19} strokeWidth={2} />
                    </span>
                    <span className="nav-label">{item.label}</span>
                    <button
                      type="button"
                      className={`nav-expand-btn ${recordsExpanded ? 'expanded' : ''}`}
                      aria-label={
                        recordsExpanded ? 'Collapse Records' : 'Expand Records'
                      }
                      aria-expanded={recordsExpanded}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setRecordsExpanded((v) => !v);
                      }}
                    >
                      <Icons.ChevronRight size={15} strokeWidth={2.25} />
                    </button>
                  </NavLink>
                  {recordsExpanded && (
                    <div className="nav-submenu">
                      {RECORDS_SUBITEMS.map((sub) => (
                        <NavLink
                          key={sub.to}
                          to={sub.to}
                          className={({ isActive }) =>
                            `nav-subitem ${isActive ? 'active' : ''}`
                          }
                          onClick={onNavigate}
                        >
                          {sub.label}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          });
        })()}
      </nav>

      <div className="sidebar-footer">
        <div className="user-info">
          <div className="user-avatar">
            {currentUser?.avatarUrl && !avatarBroken ? (
              <img
                src={avatarSrc(currentUser.avatarUrl)}
                alt=""
                className="user-avatar-img"
                onError={() => setAvatarBroken(true)}
              />
            ) : (
              currentUser?.avatar
            )}
          </div>
          <div className="user-details">
            <div className="user-name">{currentUser?.fullName}</div>
            <div className="user-role">{role?.label}</div>
          </div>
          <div className="account-menu">
            <button
              type="button"
              className="account-menu-btn"
              aria-label="Account options"
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              onClick={(e) => {
                e.stopPropagation();
                setAccountMenuOpen((v) => !v);
              }}
            >
              <Icons.MoreVertical size={16} strokeWidth={2} />
            </button>
            {accountMenuOpen && (
              <div className="account-menu-dropdown" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    setProfileOpen(true);
                  }}
                >
                  <Icons.User size={14} strokeWidth={2} /> Profile Settings
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    logout();
                  }}
                >
                  <Icons.LogOut size={14} strokeWidth={2} /> Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {collapsed && hoveredNavTip && (
        <div className="sidebar-nav-tooltip" style={{ top: hoveredNavTip.top }}>
          {hoveredNavTip.label}
        </div>
      )}

      <ProfileSettingsModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
      />
    </aside>
  );
}
