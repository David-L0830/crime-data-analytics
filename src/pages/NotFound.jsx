import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { defaultRouteForRole } from '../utils/constants';
import { Icons } from '../components/icons';

export default function NotFound() {
  const { currentUser } = useAuth();
  const home = currentUser ? defaultRouteForRole(currentUser.role) : '/login';
  return (
    <div
      className="empty-state"
      style={{ padding: '80px 20px', textAlign: 'center' }}
    >
      <div className="empty-icon">
        <Icons.Search size={40} strokeWidth={1.5} />
      </div>
      <h2 style={{ margin: '16px 0 8px' }}>Page not found</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
        The page you're looking for doesn't exist.
      </p>
      <Link to={home} className="btn btn-primary">
        Back to Dashboard
      </Link>
    </div>
  );
}
