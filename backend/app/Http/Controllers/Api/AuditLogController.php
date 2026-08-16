<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\AuditLogResource;
use App\Models\AuditLog;

class AuditLogController extends Controller
{
    // GET /api/audit-logs
    //
    // Admin-only. Access is enforced at the route level, not here:
    // routes/api.php gates this route with `role:badac_admin` (EnsureRole
    // middleware), so any other role hitting this endpoint directly gets a
    // 403 before this method ever runs — RBAC here is real backend
    // enforcement, not frontend-only filtering.
    //
    // BADAC (badac_readonly) access to this route was removed — it
    // previously mirrored badac_admin's full view (see the git history on
    // this file and BadacReadonlyTest::test_badac_readonly_cannot_view_audit_logs,
    // which used to assert the opposite). See ROLES.badac_readonly in
    // src/utils/constants.js for the matching frontend change.
    public function index()
    {
        $logs = AuditLog::with('user')->orderByDesc('created_at')->limit(200)->get();

        return AuditLogResource::collection($logs);
    }
}
