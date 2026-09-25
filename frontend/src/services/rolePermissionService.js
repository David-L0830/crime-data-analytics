import { api } from './api';

// GET /role-permissions — the Role Permissions matrix shown in Account
// Administration.
//
// The response is not a declaration of policy that this frontend then has to
// keep in step with the backend. It is the backend reading its OWN route
// middleware back out (see App\Http\Controllers\Api\RolePermissionController)
// and reporting which roles each module actually admits. That is why the
// matrix is fetched rather than written as a constant here: a hand-kept table
// in the UI would drift the first time a route's `role:` middleware changed,
// and would then be confidently wrong about who can reach what — in a
// crime-data system, the worst possible kind of wrong.
//
// Nothing rendered from this grants anything. Backend authorization remains
// the only thing that decides access.
export const rolePermissionService = {
  list: () => api.get('/role-permissions'),
};
