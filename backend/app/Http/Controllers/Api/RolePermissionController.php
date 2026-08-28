<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;

// GET /api/role-permissions — the Role Permissions matrix shown in Account
// Administration.
//
// This does NOT declare what each role may do. It READS BACK what the
// application already enforces: it walks Laravel's own registered route
// table and inspects the `role:` (EnsureRole) middleware actually attached
// to each route in routes/api.php, then groups those routes by module.
//
// That distinction is the entire point of the endpoint. A hand-written
// permissions table in the frontend would be a second copy of the rules that
// silently goes stale the moment a route's middleware changes; this cannot,
// because the middleware IS its input. If someone widens or narrows a route
// tomorrow, this matrix changes with it on the next request, with no code
// here to update.
//
// It grants nothing and is read-only. It is itself admin-only (see the
// role:badac_admin group in routes/api.php), because an exact map of which
// roles may reach which endpoints is reconnaissance for anyone who should
// not have it.
class RolePermissionController extends Controller
{
    /**
     * Which API URIs make up each module the sidebar offers.
     *
     * Keys are the module ids the frontend already uses (see NAV_ITEMS in
     * src/utils/constants.js) so the matrix lines up with the navigation the
     * administrator is looking at. Patterns are Str::is() globs against the
     * route URI.
     *
     * `except` excludes a route that a module's URI pattern would otherwise
     * sweep in. An entry is either a bare URI ('api/incidents/map') or a
     * single method on one ('GET api/crime-types'). Both exclusions below are
     * about the same thing — an endpoint whose URI sits under one module but
     * whose capability belongs to another, or to none:
     *
     *   - /incidents/map is the data source for Crime Mapping, not for Crime
     *     Data Collection.
     *   - GET /crime-types is readable by every authenticated role on
     *     purpose: it is the crime-type vocabulary the incident form, the
     *     FilterBar and the map legend are built from, not administrative
     *     configuration (see the comment on that route in routes/api.php).
     *     Counting it would report Encoder and BADAC as having "view" access
     *     to System Settings, a module neither can open — the matrix would be
     *     technically derived and still say something false. The
     *     administrator-only POST/PUT on the same URI stay in, because
     *     managing crime types IS a System Settings capability.
     *
     * A URI may legitimately belong to more than one module: Statistical
     * Analysis and Trend and Pattern Detection are two views over the same
     * analytics and Metabase-embed endpoints, and both are shown.
     *
     * @var array<string, array{label: string, patterns: array<int, string>, except?: array<int, string>}>
     */
    private const MODULES = [
        'dashboard' => [
            'label' => 'Crime Reporting Dashboard',
            'patterns' => ['api/dashboard'],
        ],
        'incident-feed' => [
            'label' => 'Crime Data Collection',
            'patterns' => ['api/incidents', 'api/incidents/*'],
            'except' => ['api/incidents/map'],
        ],
        'criminal-records' => [
            'label' => 'Records',
            'patterns' => ['api/criminals', 'api/criminals/*', 'api/victims', 'api/victims/*'],
        ],
        'mapping' => [
            'label' => 'Crime Mapping and Visualization',
            'patterns' => ['api/incidents/map'],
        ],
        'analytics' => [
            'label' => 'Statistical Analysis',
            'patterns' => ['api/analytics', 'api/analytics/*', 'api/embed/metabase/*'],
        ],
        'trends' => [
            'label' => 'Trend and Pattern Detection',
            'patterns' => ['api/analytics', 'api/analytics/*', 'api/embed/metabase/*'],
        ],
        'audit-logs' => [
            'label' => 'Audit Logs',
            'patterns' => ['api/audit-logs'],
        ],
        'user-management' => [
            'label' => 'User Management',
            'patterns' => ['api/users', 'api/users/*', 'api/role-permissions'],
        ],
        'settings' => [
            'label' => 'System Settings',
            'patterns' => ['api/settings', 'api/crime-types', 'api/crime-types/*', 'api/sync-logs'],
            'except' => ['GET api/crime-types'],
        ],
    ];

    private const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

    public function index()
    {
        $roles = array_keys(User::ROLE_LABELS);
        $modules = [];

        foreach (self::MODULES as $id => $definition) {
            $routes = $this->routesForModule($definition);

            $access = [];
            foreach ($roles as $role) {
                $access[$role] = $this->accessLevel($routes, $role);
            }

            $modules[] = [
                'id' => $id,
                'label' => $definition['label'],
                'access' => $access,
                // The evidence behind the row, so an administrator can see
                // WHY a cell says what it says rather than taking it on faith.
                'endpoints' => array_values(array_map(
                    fn (array $r) => implode('|', $r['methods']).' /'.$r['uri'],
                    $routes
                )),
            ];
        }

        return response()->json([
            'data' => [
                'roles' => array_map(
                    fn (string $key) => ['key' => $key, 'label' => User::ROLE_LABELS[$key]],
                    $roles
                ),
                'modules' => $modules,
            ],
        ]);
    }

    /**
     * Every registered API route belonging to this module, reduced to the
     * facts the matrix needs: its methods, and which roles its middleware
     * actually admits.
     *
     * @param  array{patterns: array<int, string>, except?: array<int, string>}  $definition
     * @return array<int, array{uri: string, methods: array<int, string>, roles: array<int, string>}>
     */
    private function routesForModule(array $definition): array
    {
        $matched = [];

        foreach (Route::getRoutes() as $route) {
            /** @var RoutingRoute $route */
            $uri = $route->uri();
            $methods = array_values(array_diff($route->methods(), ['HEAD', 'OPTIONS']));

            if ($this->isExcluded($uri, $methods, $definition['except'] ?? [])) {
                continue;
            }

            $belongs = false;
            foreach ($definition['patterns'] as $pattern) {
                if (Str::is($pattern, $uri)) {
                    $belongs = true;
                    break;
                }
            }

            if (! $belongs) {
                continue;
            }

            $roles = $this->rolesAdmittedBy($route);
            if ($roles === null) {
                // Not an authenticated route at all (nothing in this app's
                // module map should hit this, but a public route must never
                // be reported as though a role gated it).
                continue;
            }

            $matched[] = [
                'uri' => $uri,
                // HEAD is registered automatically alongside every GET, and
                // OPTIONS by CORS handling; neither is a capability anyone
                // reasons about, so both were dropped above.
                'methods' => $methods,
                'roles' => $roles,
            ];
        }

        return $matched;
    }

    /**
     * Whether a route is excluded from a module by its `except` list.
     *
     * A bare 'api/foo' entry excludes every method on that URI; a
     * 'GET api/foo' entry excludes only that method, which is what lets one
     * URI contribute its administrator-only writes to a module while its
     * everyone-can-read GET stays out.
     *
     * @param  array<int, string>  $methods
     * @param  array<int, string>  $except
     */
    private function isExcluded(string $uri, array $methods, array $except): bool
    {
        foreach ($except as $entry) {
            if ($entry === $uri) {
                return true;
            }

            if (str_contains($entry, ' ')) {
                [$method, $exceptUri] = explode(' ', $entry, 2);
                if ($exceptUri === $uri && $methods === [strtoupper($method)]) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * The roles a route's own middleware admits, or null when the route is
     * not authenticated at all.
     *
     * A route carrying `role:a,b` admits exactly a and b. A route that is
     * authenticated but carries no `role:` middleware admits every role —
     * that is not an assumption, it is what EnsureRole not being attached
     * means (see backend/routes/api.php, where GET /incidents is
     * deliberately open to all three roles this way).
     *
     * @return array<int, string>|null
     */
    private function rolesAdmittedBy(RoutingRoute $route): ?array
    {
        $middleware = $route->gatherMiddleware();
        $authenticated = false;

        foreach ($middleware as $entry) {
            if (! is_string($entry)) {
                continue;
            }

            if ($entry === 'auth:supabase' || Str::startsWith($entry, 'auth:')) {
                $authenticated = true;
            }

            if (Str::startsWith($entry, 'role:')) {
                return array_values(array_filter(
                    array_map('trim', explode(',', Str::after($entry, 'role:')))
                ));
            }
        }

        return $authenticated ? array_keys(User::ROLE_LABELS) : null;
    }

    /**
     * 'full' when the role may both read and write somewhere in the module,
     * 'view' when it may only read, 'none' when no route in the module
     * admits it.
     *
     * @param  array<int, array{uri: string, methods: array<int, string>, roles: array<int, string>}>  $routes
     */
    private function accessLevel(array $routes, string $role): string
    {
        $canRead = false;
        $canWrite = false;

        foreach ($routes as $route) {
            if (! in_array($role, $route['roles'], true)) {
                continue;
            }

            if (array_intersect($route['methods'], self::WRITE_METHODS)) {
                $canWrite = true;
            }

            if (in_array('GET', $route['methods'], true)) {
                $canRead = true;
            }
        }

        return $canWrite ? 'full' : ($canRead ? 'view' : 'none');
    }
}
