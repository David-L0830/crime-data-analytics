<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\User;
use App\Http\Resources\UserResource;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

// Checkpoint 25 — Sidebar / Profile Settings ("⋮" menu on the account card).
//
// Deliberately separate from UserController (Phase 4 Admin User Management):
// every route here acts ONLY on the authenticated caller's own account
// (`$request->user()`), never on a {user} route-model-bound target, so it
// carries none of UserController's "acting on someone else's account" risk
// and does not need the `role:badac_admin` gate — any authenticated account
// (admin, encoder, or the read-only Badac viewer) may edit its own display
// name and avatar. This mirrors GET /api/user's existing aal1-is-fine
// precedent (see routes/api.php comment on that route): editing your own
// non-security-sensitive profile fields is the same trust level as reading
// them.
//
// Scope is intentionally narrower than UserController::update — username,
// email, role, and account-status are NOT editable here. Those remain
// admin-only through UserController/UpdateUserRequest, unchanged by this
// checkpoint, because they're either account-security-relevant (email is
// the password-reset destination, username is the login identifier) or an
// authorization concern (role/isActive) — exactly the kind of field this
// checkpoint's own instructions say not to touch.
class ProfileController extends Controller
{
    // PUT /api/me — display name only.
    public function update(Request $request)
    {
        $user = $request->user();

        $data = $request->validate([
            'fullName' => ['required', 'string', 'max:255'],
        ]);

        $user->update(['name' => $data['fullName']]);

        AuditLog::create([
            'user_id' => $user->id,
            'action' => 'UPDATE',
            'module' => 'users',
            'target_type' => 'user',
            'description' => "{$user->username} updated their own profile details",
            'ip_address' => $request->ip(),
        ]);

        return new UserResource($user);
    }

    // POST /api/me/avatar — multipart upload, stored on the `public` disk
    // under avatars/{userId}.{ext} (a fixed per-user path, not a random
    // filename) so a re-upload simply overwrites the previous picture
    // instead of leaking the old one on disk forever.
    //
    // NOTE (environment): this relies on `php artisan storage:link` having
    // been run so storage/app/public is reachable at backend/public/storage
    // — the same requirement every other Laravel install has for public
    // file uploads. Could not run that command (or otherwise exercise this
    // endpoint end-to-end against a live database) in this sandbox — see
    // the checkpoint report for exactly what is IMPLEMENTED / NOT VERIFIED.
    public function avatar(Request $request)
    {
        $user = $request->user();

        $request->validate([
            'avatar' => ['required', 'image', 'mimes:jpg,jpeg,png,webp', 'max:4096'],
        ]);

        $file = $request->file('avatar');
        $path = $file->storeAs('avatars', $user->id.'.'.$file->extension(), 'public');

        // Explicit column, not mass-assignment — avatar_path is deliberately
        // left out of User::$fillable (same pattern as the two_factor_*
        // columns) since it's only ever meant to be set from here, after
        // this method's own validation/storage step, never from a generic
        // update() payload.
        $user->forceFill(['avatar_path' => $path])->save();

        AuditLog::create([
            'user_id' => $user->id,
            'action' => 'UPDATE',
            'module' => 'users',
            'target_type' => 'user',
            'description' => "{$user->username} updated their profile picture",
            'ip_address' => $request->ip(),
        ]);

        return new UserResource($user);
    }
}
