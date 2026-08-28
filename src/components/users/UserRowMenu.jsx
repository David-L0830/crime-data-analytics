import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icons } from '../icons';

// The "⋮" actions menu on each row of the Account Administration table.
//
// Visually this is the same control the sidebar already uses for Profile
// Settings (.account-menu-btn / .account-menu-dropdown), so the page gains no
// new design language. What differs is HOW it is positioned, and that is not
// a stylistic preference: the table lives inside `.table-wrap`, which sets
// `overflow-x: auto`. A scroll container clips on both axes, so an absolutely
// positioned dropdown — the sidebar's approach — would be cut off at the edge
// of the table for every row, and cut off vertically for the last row. The
// menu is therefore rendered through a portal at the document level and
// positioned with `position: fixed` against the button's own bounding box,
// which no ancestor can clip.
//
// Because a fixed position is a snapshot of where the button was, the menu
// closes on scroll and on resize rather than trying to chase it. That is the
// behaviour people expect from a row menu anyway, and it cannot drift out of
// alignment with the row it belongs to.
//
// `items`: [{ key, label, icon?, onSelect, danger?, disabled?, title?,
// separatorBefore? }]. A disabled item stays in the menu rather than
// disappearing, so an administrator can see that an action exists and why it
// is unavailable to them right now (e.g. deactivating your own account).
export default function UserRowMenu({ items, label = 'Account actions' }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  // Measured after the menu has mounted but before the browser paints, so it
  // never appears in the wrong place for a frame.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const spaceBelow = window.innerHeight - rect.bottom;

    setPosition({
      // Right-aligned to the button, clamped so a narrow viewport can never
      // push the menu off the left edge.
      left: Math.max(8, rect.right - 200),
      // Flips above the button when there isn't room below it — the last rows
      // of a long table would otherwise open into the fold.
      top:
        spaceBelow < menuHeight + 12 && rect.top > menuHeight
          ? rect.top - menuHeight - 6
          : rect.bottom + 6,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const close = () => setOpen(false);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointerDown = (e) => {
      if (
        !menuRef.current?.contains(e.target) &&
        !buttonRef.current?.contains(e.target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointerDown);
    // `true` — capture phase, so scrolling INSIDE .table-wrap closes the menu
    // too, not just scrolling the page.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        className="account-menu-btn row-menu-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <Icons.MoreVertical size={16} strokeWidth={2} />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="account-menu-dropdown row-menu-dropdown"
            role="menu"
            aria-label={label}
            style={{
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              // Hidden until measured, so it cannot flash at the top-left of
              // the viewport on the first frame.
              visibility: position ? 'visible' : 'hidden',
            }}
          >
            {items.map((item) => (
              <div key={item.key}>
                {item.separatorBefore && <div className="row-menu-separator" />}
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  title={item.title}
                  className={item.danger ? 'row-menu-danger' : undefined}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  {item.icon}
                  {item.label}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
