import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { defaultRouteForRole } from '../utils/constants';

// Wraps a page element: redirects to /login when signed out, and to the first
// module the user's role can access when they hit a route their role doesn't allow.
export default function ProtectedRoute({ moduleId, children }) {
  const { currentUser, hasAccess, initializing } = useAuth();
  const location = useLocation();

  if (initializing) return null;

  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (moduleId && !hasAccess(moduleId)) {
    return <Navigate to={defaultRouteForRole(currentUser.role)} replace />;
  }

  return children;
}
