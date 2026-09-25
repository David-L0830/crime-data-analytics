import { useEffect, useId, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { NAV_ITEMS, NAV_SECTION_LABELS } from '../../utils/constants';
import {
  RECORDS_SUBITEMS,
  CRIMINAL_RECORDS_PATH,
  activeRecordsItem,
  isRecordsPath,
} from '../../utils/recordsNav';
import { useAuth } from '../../hooks/useAuth';
import { NAV_ICONS, Icons } from '../icons';
import logo from '../../assets/images/barangay178-logo.png';
import ProfileSettingsModal from './ProfileSettingsModal';

// The Records nav item's id/moduleId is 'criminal-records' (see constants.js's
// own comment on NAV_ITEMS), so RBAC is unchanged. It is a navigation GROUP:
// its header is a disclosure button that expands Criminal Records and Victim
// Records, which are the real destinations. There is no Records page to land
// on any more; /criminal-records itself redirects to Criminal Records.
const RECORDS_ITEM_ID = 'criminal-records';

export default function Sidebar({ open, collapsed, isMobile, onNavigate }) {
  const { currentUser, role, hasAccess, logout, avatarSrc } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const asideRef = useRef(null);
  const recordsSubmenuId = useId();
  const [recordsExpanded, setRecordsExpanded] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  // Checkpoint 39 (Task 9.3) — same broken-image fallback as
  // ProfileSettingsModal; see that file's comment for why.
  const [avatarBroken, setAvatarBroken] = useState(false);
  const accountBtnRef = useRef(null);
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

  // The tooltip is the only thing that names a nav item on the 72px collapsed
  // rail, where the label text is hidden and all that remains is an icon.
  // Bound to mouse events alone, it was unreachable without a pointer: a
  // keyboard user tabbing the rail got a column of unlabelled icons. Focus and
  // blur are the keyboard's equivalents of enter and leave, so the same
  // handlers are simply bound to both. Each nav item also keeps its
  // aria-label, so a screen reader was never the affected case — this is for
  // the sighted keyboard user.
  const navTipHandlers = (label) => ({
    onMouseEnter: showNavTip(label),
    onMouseLeave: hideNavTip,
    onFocus: showNavTip(label),
    onBlur: hideNavTip,
  });

  const activeRecords = activeRecordsItem(location.pathname);
  const onRecordsSubroute = isRecordsPath(location.pathname);

  // Auto-open the submenu when navigation (not a sidebar click) lands inside
  // Records, e.g. a refresh, a deep link to a profile, or a "view record" link
  // from another page — otherwise the active sub-item would be hidden inside a
  // collapsed submenu. It never auto-closes: the user decides that.
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

  // Escape closes the account menu, matching the Escape that closes the mobile
  // drawer and every Modal. Focus goes back to the button that opened it, so
  // dismissing the menu from the keyboard does not drop the user at the top of
  // the document.
  //
  // Registered in the CAPTURE phase so this Escape is handled first and only
  // closes the menu. MainLayout's drawer Escape listener is also on document
  // but in the bubble phase; a capture listener on document runs before it,
  // and stopPropagation() then keeps it from firing. Without capture, both
  // listeners sat in the same phase, the drawer's (registered first) ran
  // first, and one Escape closed the menu and the drawer together.
  useEffect(() => {
    if (!accountMenuOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setAccountMenuOpen(false);
      accountBtnRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [accountMenuOpen]);

  // When the drawer opens on a phone, focus moves into it. Otherwise the
  // keyboard user presses the hamburger, the panel appears, and their focus is
  // still on the hamburger — the next Tab walks the topbar instead of the
  // navigation they just asked for.
  //
  // A single focus() call here is not enough. When this effect runs, the nav
  // item can still compute as visibility: hidden (inherited from the closed
  // drawer rule in global.css) for about one frame, and focus() on a hidden
  // element silently does nothing. So the attempt is repeated on each animation
  // frame until the element has actually taken focus — tied to the real render
  // state rather than a guessed delay — with a small cap so it can never loop,
  // and cancelled if the drawer closes first.
  useEffect(() => {
    if (!isMobile || !open) return undefined;
    const first = asideRef.current?.querySelector('.nav-item');
    if (!first) return undefined;
    let frame = 0;
    let attemptsLeft = 10;
    const tryFocus = () => {
      first.focus();
      if (document.activeElement !== first && attemptsLeft-- > 0) {
        frame = requestAnimationFrame(tryFocus);
      }
    };
    tryFocus();
    return () => cancelAnimationFrame(frame);
  }, [isMobile, open]);

  // THE fix for the off-screen-but-focusable drawer.
  //
  // At <=768px the closed sidebar is moved out of view with
  // transform: translateX(-100%). A transform is a paint-time operation: it
  // changes where the element is drawn and nothing else. The links stay in the
  // tab order and stay in the accessibility tree, so on a phone a keyboard user
  // tabbing off the hamburger walked through roughly a dozen invisible
  // navigation links, the Records expander and the account button before
  // reaching any page content, and a screen reader read out a navigation that
  // was not on screen.
  //
  // `inert` is the attribute that actually means what is wanted here: not
  // focusable, not clickable, not exposed to assistive technology. React 19
  // passes it through as a real boolean attribute. The stylesheet carries a
  // `visibility: hidden` fallback on the same state for engines without inert
  // support, which removes descendants from the tab order and the
  // accessibility tree as well — see the `.sidebar` rule in the max-width:768px
  // block. The two agree, so neither can contradict the other.
  //
  // Scoped to `isMobile && !open`: on desktop, and whenever the drawer is
  // open, this is undefined and the sidebar behaves exactly as it always has.
  const drawerClosed = Boolean(isMobile) && !open;

  return (
    <aside
      ref={asideRef}
      className={`sidebar ${open ? 'open' : ''}`}
      inert={drawerClosed ? true : undefined}
      aria-label="Main navigation"
    >
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
                    {...navTipHandlers(item.label)}
                  >
                    <span className="nav-icon">
                      <NavIcon size={19} strokeWidth={2} />
                    </span>
                    <span className="nav-label">{item.label}</span>
                  </NavLink>
                </div>
              );
            }

            // The group header is ONE button — the whole row, chevron
            // included — with aria-expanded/aria-controls, which is the
            // disclosure pattern screen readers and keyboards understand
            // (Enter/Space toggle it). It is not a link, because there is no
            // Records page for it to open.
            //
            // On the 72px collapsed rail the submenu cannot be shown, so the
            // same button instead goes straight to Criminal Records, the
            // group's first destination; Victim Records stays one click away
            // from there and from the expanded sidebar.
            const onRecordsHeaderClick = () => {
              if (collapsed) {
                navigate(CRIMINAL_RECORDS_PATH);
                onNavigate?.();
                return;
              }
              setRecordsExpanded((v) => !v);
            };

            return (
              <div key={item.id}>
                {sectionLabel}
                <div className="nav-group">
                  <button
                    type="button"
                    className={`nav-item nav-item-parent nav-group-toggle ${onRecordsSubroute ? 'active' : ''}`}
                    onClick={onRecordsHeaderClick}
                    aria-expanded={recordsExpanded}
                    aria-controls={recordsSubmenuId}
                    aria-label={item.label}
                    title={collapsed ? undefined : item.label}
                    {...navTipHandlers(item.label)}
                  >
                    <span className="nav-icon">
                      <NavIcon size={19} strokeWidth={2} />
                    </span>
                    <span className="nav-label">{item.label}</span>
                    <span
                      className={`nav-group-chevron ${recordsExpanded ? 'expanded' : ''}`}
                      aria-hidden="true"
                    >
                      <Icons.ChevronRight size={15} strokeWidth={2.25} />
                    </span>
                  </button>
                  <ul
                    id={recordsSubmenuId}
                    className="nav-submenu"
                    hidden={!recordsExpanded}
                  >
                    {RECORDS_SUBITEMS.map((sub) => {
                      const current = activeRecords === sub.key;
                      return (
                        <li key={sub.to}>
                          <NavLink
                            to={sub.to}
                            className={`nav-subitem ${current ? 'active' : ''}`}
                            onClick={onNavigate}
                          >
                            {sub.label}
                          </NavLink>
                        </li>
                      );
                    })}
                  </ul>
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
              ref={accountBtnRef}
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
