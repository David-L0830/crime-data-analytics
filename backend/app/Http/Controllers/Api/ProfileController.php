<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Services\SupabaseStorageService;
use App\Support\Audit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

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
//
// ---------------------------------------------------------------------------
// AVATAR STORAGE
// ---------------------------------------------------------------------------
//
// avatar() used to write to the `public` LOCAL disk and report success on the
// strength of having tried. Two things were wrong with that, and both produced
// the same symptom — "my profile picture did not save":
//
//   1. Render's container filesystem is EPHEMERAL. The write succeeded, the
//      row was updated, the picture appeared, and it survived a refresh — then
//      disappeared at the next deploy or idle-restart, because the directory it
//      lived in no longer existed. `php artisan storage:link` in the entrypoint
//      was never the problem; the symlink was fine, its target was empty.
//
//   2. The `public` disk is configured with `'throw' => false` (see
//      config/filesystems.php), so a failed write returns FALSE rather than
//      raising. The old code assigned that false straight into avatar_path and
//      returned 200. A person was told their picture was saved at the exact
//      moment the storage layer had said it was not.
//
// Uploads now go to Supabase Storage when a bucket is configured — the same
// vendor this project already uses for auth and the database, so no new
// dependency — and the local disk remains only as a development fallback. Both
// paths now verify the write before touching the database, and a failure is a
// 500 with a message that says what went wrong.
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

        // Re-read from the database rather than trusting the in-memory model.
        //
        // update() writes and mutates the instance in one step, so the object
        // reports the new name whether or not the row actually changed — a
        // silently swallowed write (a database in recovery, a row removed by
        // an administrator mid-request) would still have produced a 200 with
        // the new name in it, and the UI would have shown a saved profile that
        // was not saved. Refreshing makes the response state what the database
        // holds, which is the only thing that survives the page reload the user
        // is about to do.
        $user->refresh();

        Audit::record([
            'user_id' => $user->id,
            'action' => 'UPDATE',
            'module' => 'users',
            'target_type' => 'user',
            'description' => "{$user->username} updated their own profile details",
            'ip_address' => $request->ip(),
        ]);

        return new UserResource($user);
    }

    /**
     * POST /api/me/avatar — multipart upload of the caller's own picture.
     *
     * AUTHORIZATION is structural, not checked: the target is always
     * `$request->user()`. There is no {user} parameter to tamper with, so
     * "users may only change their own avatar" holds by construction rather
     * than by a comparison somebody could later get wrong.
     */
    public function avatar(Request $request, SupabaseStorageService $storage)
    {
        $user = $request->user();

        $request->validate([
            'avatar' => ['required', 'image', 'mimes:jpg,jpeg,png,webp', 'max:4096'],
        ]);

        $file = $request->file('avatar');
        $previous = $user->avatar_path;

        try {
            $stored = $storage->isConfigured()
                ? $storage->putAvatar($user->id, $file)
                : $this->storeOnLocalDisk($user->id, $file);
        } catch (RuntimeException $e) {
            // Logged for the operator with the real reason, and reported to the
            // caller with the same reason: this is a configuration or
            // connectivity fault on our side, not something the person can fix
            // by choosing a different picture, and a generic "something went
            // wrong" would send them round the loop again. The message is built
            // by the storage service and never contains a credential.
            Log::error('Avatar upload failed', [
                'user_id' => $user->id,
                'reason' => $e->getMessage(),
            ]);

            return response()->json([
                'message' => 'Your profile picture could not be saved: '.$e->getMessage(),
            ], 500);
        }

        // Only NOW is the database told about it. Writing the column first and
        // uploading afterwards would leave a row pointing at an object that
        // does not exist whenever the upload failed.
        //
        // Explicit column, not mass-assignment — avatar_path is deliberately
        // left out of User::$fillable (same pattern as the two_factor_*
        // columns) since it's only ever meant to be set from here, after this
        // method's own validation and storage step, never from a generic
        // update() payload.
        $user->forceFill(['avatar_path' => $stored])->save();

        // A picture stored under a different key than the previous one (someone
        // replacing a PNG with a JPEG) leaves the old object behind, since the
        // key carries the extension. Same-key uploads overwrite and need no
        // cleanup. Best effort by design — see deleteObject().
        if ($previous && $previous !== $stored) {
            $this->forgetPreviousAvatar($storage, $previous);
        }

        Audit::record([
            'user_id' => $user->id,
            'action' => 'UPDATE',
            'module' => 'users',
            'target_type' => 'user',
            'description' => "{$user->username} updated their profile picture",
            'ip_address' => $request->ip(),
        ]);

        return new UserResource($user->refresh());
    }

    /**
     * Development fallback: write to the `public` local disk.
     *
     * Kept so a developer with no Supabase bucket (and the test suite, which
     * uses Storage::fake) still has a working upload path. NOT suitable for
     * Render — see this class's header comment.
     *
     * @throws RuntimeException when the disk refuses the write. The `public`
     *                          disk is configured with 'throw' => false, so
     *                          storeAs() returns false instead of raising; that
     *                          false used to be written into the database as
     *                          the avatar path and reported as a success.
     */
    private function storeOnLocalDisk(int|string $userId, $file): string
    {
        $path = $file->storeAs('avatars', $userId.'.'.$file->extension(), 'public');

        if ($path === false || $path === '' || $path === null) {
            throw new RuntimeException(
                'the server could not write the file to local storage. '.
                'On a deployed container this disk is also temporary — configure '.
                'SUPABASE_AVATAR_BUCKET so pictures survive a restart.'
            );
        }

        return $path;
    }

    /**
     * Removes a superseded avatar, whichever store it lived in.
     *
     * Never fatal: an orphaned old picture costs a few kilobytes, and failing
     * the request over one would deny somebody the new picture they just
     * successfully uploaded.
     */
    private function forgetPreviousAvatar(SupabaseStorageService $storage, string $previous): void
    {
        $key = $storage->objectKeyFromUrl($previous);

        if ($key !== null) {
            $storage->deleteObject($key);

            return;
        }

        // A relative path is a local-disk avatar from before Supabase Storage
        // was configured. An absolute URL that is not ours is left alone.
        if (! str_starts_with($previous, 'http://') && ! str_starts_with($previous, 'https://')) {
            try {
                Storage::disk('public')->delete($previous);
            } catch (\Throwable) {
                // Same reasoning as above.
            }
        }
    }
}
