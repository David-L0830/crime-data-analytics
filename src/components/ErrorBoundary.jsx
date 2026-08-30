import { Component } from 'react';
import { Icons } from './icons';
import Button from './ui/Button';

// The ONLY class component in src/.
//
// React 19 still has no hook equivalent for catching render errors —
// getDerivedStateFromError and componentDidCatch are class-only APIs — so
// this is a deliberate exception to this codebase's function-component
// convention, not an oversight. (ApiError in services/api.js is the only
// other `class` here, and that one extends Error.)
//
// WHY IT IS MOUNTED WHERE IT IS
//
// This wraps <Outlet /> inside MainLayout rather than <AppRoutes /> inside
// App.jsx, so a page that throws leaves the sidebar and the header still
// mounted and usable. The person can navigate to another module instead of
// facing a blank document with no way out. Wrapping higher up would take the
// navigation down with the page.
//
// The concrete bug class this exists to contain is documented at
// Dashboard.jsx's `recent` sort: incident_time is nullable, so a record with
// no time made .localeCompare throw during render — and one throw in one
// table blanked the entire application. That specific call is now guarded,
// but the general hazard is not: every page computes its figures from live
// records in the browser, and any one of those computations can meet a null
// it did not expect.
//
// RESET BEHAVIOUR
//
// This component deliberately holds no reset logic. MainLayout renders it
// with key={location.pathname}, so React unmounts and remounts it on every
// navigation, which clears the error state for free. Keeping the reset out
// of here is what lets this stay hook-free — a class component cannot call
// useLocation itself.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Logged rather than sent anywhere: this application has no error
    // reporting service, and the console is where a developer or an
    // administrator running the system will actually look. The component
    // stack is the part that says WHICH page failed, so it is included.
    console.error(
      'Unhandled render error caught by ErrorBoundary:',
      error,
      info?.componentStack,
    );
  }

  render() {
    const { error } = this.state;

    if (!error) {
      return this.props.children;
    }

    return (
      <div className="empty-state" role="alert">
        <div className="empty-icon">
          <Icons.AlertTriangle size={32} strokeWidth={1.5} />
        </div>
        <h3>This page could not be displayed</h3>
        <p
          style={{
            color: 'var(--text-muted)',
            maxWidth: 480,
            margin: '0 auto',
          }}
        >
          Something went wrong while building this screen. Your data has not
          been changed. You can move to another module using the menu, or reload
          to try this page again.
        </p>
        {/* The message, not the stack. It is shown because this is an
            internal barangay administration tool: "Cannot read properties of
            null" tells the administrator and the developer far more than a
            generic apology would, and the full stack is already in the
            console for whoever needs it. */}
        {error.message && (
          <p
            style={{
              marginTop: 10,
              fontSize: '0.8rem',
              fontFamily: 'monospace',
              color: 'var(--text-secondary)',
              wordBreak: 'break-word',
            }}
          >
            {error.message}
          </p>
        )}
        <div style={{ marginTop: 18 }}>
          {/* Deliberately a reload, not a "try again" that merely clears the
              error state — that would re-render the same broken page against
              the same data and throw again immediately. */}
          <Button variant="secondary" onClick={() => window.location.reload()}>
            <Icons.Sync size={15} strokeWidth={2} /> Reload page
          </Button>
        </div>
      </div>
    );
  }
}
