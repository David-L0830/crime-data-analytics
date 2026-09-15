import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The mobile navigation drawer must not be reachable while it is off screen.
 *
 * At <=768px the sidebar is moved out of view with
 * transform: translateX(-100%). A transform is a paint-time operation: it
 * changes where an element is drawn and nothing else. The links stayed in the
 * tab order and stayed in the accessibility tree, so on a phone a keyboard
 * user tabbing off the hamburger walked roughly a dozen invisible navigation
 * links before reaching any page content, and a screen reader read out a
 * navigation that was not on screen.
 *
 * WHAT THIS SUITE IS, AND WHAT IT IS NOT
 *
 * SOURCE-LEVEL regression guards, in the same style as
 * incidentModalFocus.test.js, which says the same thing about itself: the
 * Vitest environment is `node` with no DOM (see vitest.config.js), so focus
 * order, the accessibility tree and media queries cannot be observed here.
 *
 * Nothing below proves the drawer behaves correctly on a phone. It proves the
 * two mechanisms that make it behave correctly are still present and still
 * agree with each other. The behavioural proof is a keyboard pass and a screen
 * reader pass in a real browser at a real viewport, which must be re-run
 * whenever this area changes.
 */

const here = dirname(fileURLToPath(import.meta.url));
const sidebar = readFileSync(join(here, 'Sidebar.jsx'), 'utf8');
const layout = readFileSync(
  join(here, '..', '..', 'layouts', 'MainLayout.jsx'),
  'utf8',
);
const css = readFileSync(
  join(here, '..', '..', 'styles', 'global.css'),
  'utf8',
);

describe('the closed mobile drawer is removed from the tab order', () => {
  it('marks the sidebar inert only when it is a closed drawer', () => {
    // Scoped to mobile AND closed. On desktop, and whenever it is open, the
    // attribute is undefined and the sidebar behaves as it always has.
    expect(sidebar).toContain(
      'const drawerClosed = Boolean(isMobile) && !open;',
    );
    expect(sidebar).toContain('inert={drawerClosed ? true : undefined}');
  });

  it('carries a CSS fallback for engines without inert', () => {
    // inert has good but not universal support, and the consequence of it
    // being ignored is the original defect returning silently. visibility:
    // hidden removes descendants from the tab order and the accessibility
    // tree in every engine.
    const mobileBlock = css.slice(css.indexOf('@media (max-width: 768px)'));
    const sidebarRule = mobileBlock.slice(0, mobileBlock.indexOf('.sidebar.open'));
    expect(sidebarRule).toContain('transform: translateX(-100%)');
    expect(sidebarRule).toContain('visibility: hidden');
  });

  it('makes the open drawer visible again with no delay', () => {
    // The hide is delayed so it does not interrupt the slide-out animation;
    // the show must not be, or the drawer is unreachable while it slides in.
    const openRule = css.slice(css.indexOf('.sidebar.open {'));
    expect(openRule.slice(0, 400)).toContain('visibility: visible');
    expect(openRule.slice(0, 400)).toContain('visibility 0s linear 0s');
  });

  it('never hides the navigation while the drawer is open', () => {
    // The opposite failure: an aria-hidden or inert that stays applied once
    // the drawer is on screen would make the navigation unusable rather than
    // merely unreachable.
    expect(sidebar).not.toContain('aria-hidden="true"\n    >');
    expect(sidebar).toContain('aria-label="Main navigation"');
  });
});

describe('the drawer behaves like an overlay panel', () => {
  it('tracks the breakpoint instead of reading innerWidth on click', () => {
    // The old handler read window.innerWidth at click time only, so a drawer
    // opened on a phone stayed flagged open after a resize to desktop width.
    expect(layout).toContain("const MOBILE_QUERY = '(max-width: 768px)';");
    expect(layout).toContain("mq.addEventListener('change', onChange)");
    expect(layout).not.toContain('window.innerWidth <= 768');
  });

  it('closes the drawer when the viewport stops being mobile', () => {
    expect(layout).toContain('if (!e.matches) setMobileOpen(false);');
  });

  it('closes on Escape, bound only while open', () => {
    expect(layout).toMatch(
      /if \(!isMobile \|\| !mobileOpen\) return undefined;[\s\S]{0,300}?Escape/,
    );
  });

  it('renders a mobile-only backdrop that dismisses on click', () => {
    expect(layout).toContain('{isMobile && mobileOpen && (');
    expect(layout).toContain('className="sidebar-backdrop"');
    expect(layout).toContain('onClick={() => setMobileOpen(false)}');
    expect(css).toContain('.sidebar-backdrop {');
  });

  it('moves focus into the drawer on open and back out on close', () => {
    // Opening a panel and leaving focus behind it is the defect; so is
    // dismissing one and dropping focus to the document body.
    expect(sidebar).toContain("querySelector('.nav-item')");
    expect(layout).toContain('const btn = menuButtonRef.current;');
    expect(layout).toContain('if (btn && btn.isConnected) btn.focus();');
    // Only on a real open->closed transition, never on first render.
    expect(layout).toContain('if (wasOpen.current && !mobileOpen) {');
  });
});

describe('the collapsed rail is labelled for the keyboard', () => {
  it('shows the nav tooltip on focus as well as hover', () => {
    // On the 72px rail the tooltip is the only thing that names an item, and
    // it was bound to mouse events alone.
    expect(sidebar).toContain('onFocus: showNavTip(label)');
    expect(sidebar).toContain('onBlur: hideNavTip');
  });
});

describe('the skip link exists and has somewhere to go', () => {
  it('is rendered before the sidebar', () => {
    expect(layout).toContain('className="skip-link" href="#main-content"');
    expect(layout.indexOf('skip-link')).toBeLessThan(
      layout.indexOf('<Sidebar'),
    );
  });

  it('targets a focusable main region', () => {
    // Without tabIndex={-1} the browser scrolls but leaves focus behind, and
    // the next Tab continues from the skip link — the jump achieves nothing.
    expect(layout).toContain('id="main-content"');
    expect(layout).toContain('tabIndex={-1}');
    expect(css).toContain('.skip-link {');
    expect(css).toContain('.skip-link:focus {');
  });
});
