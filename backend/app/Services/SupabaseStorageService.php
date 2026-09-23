<?php

namespace App\Services;

use App\Support\SupabaseEndpoint;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Stores profile pictures in Supabase Storage.
 *
 * WHY THIS EXISTS
 *
 * Avatars used to be written to the `public` local disk —
 * storage/app/public/avatars/{id}.{ext} — which is correct on a developer's
 * machine and wrong on Render. A Render container's filesystem is ephemeral:
 * it is rebuilt on every deploy and on every restart, including the automatic
 * restarts a free instance makes after idling. So the upload succeeded, the
 * database recorded a path, the picture appeared immediately and survived a
 * page refresh — and then vanished at the next deploy, leaving a row pointing
 * at a file that no longer existed. The frontend's broken-image fallback then
 * quietly showed initials again, which is why it read as "the profile change
 * did not save" rather than as a storage failure.
 *
 * `php artisan storage:link` in docker/entrypoint.sh was already correct and
 * was never the problem: it recreates the symlink, but the symlink's target
 * directory is empty on a fresh container.
 *
 * Supabase Storage is the right home for this because the project already
 * depends on Supabase for authentication and for the database — this adds no
 * new vendor, no new account, and no new credential. The backend already holds
 * a service-role key for exactly one purpose (SupabaseAdminService); this is
 * the second, and it stays server-side for the same reason.
 *
 * WHY THE UPLOAD GOES THROUGH LARAVEL RATHER THAN STRAIGHT FROM THE BROWSER
 *
 * Uploading directly from React would need a credential in the browser that
 * can write to the bucket. The service-role key can never go there. The
 * alternative — per-user RLS policies on storage.objects keyed to the Supabase
 * JWT — would put the "may this person change this avatar" decision in a
 * second authorization system, separate from the `role:` middleware that
 * decides everything else in this application. One authorization model is
 * worth an extra hop: the file goes browser → Laravel (which already knows who
 * the caller is) → Supabase.
 *
 * CONFIGURATION
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (both already required by
 * SupabaseAdminService) plus SUPABASE_AVATAR_BUCKET. When the bucket is not
 * configured this service reports itself unconfigured and ProfileController
 * falls back to the local disk, so a developer with no Supabase project keeps
 * working exactly as before.
 *
 * The bucket must exist and must be PUBLIC — the avatar is rendered by an
 * ordinary <img src>, and a private bucket would require a signed URL that
 * expires, which is not something a cached <img> can renew. A profile picture
 * is not confidential: it is shown in the sidebar to everyone who can see the
 * account.
 */
class SupabaseStorageService
{
    /**
     * Whether avatars should go to Supabase Storage at all.
     *
     * Checked rather than assumed so a missing bucket degrades to local-disk
     * storage instead of failing every upload. ProfileController reports which
     * path it took.
     */
    public function isConfigured(): bool
    {
        return $this->url() !== '' && $this->key() !== '' && $this->bucket() !== '';
    }

    public function bucket(): string
    {
        return trim((string) config('supabase.avatar_bucket'), '/');
    }

    // The PUBLIC address: object URLs built from it are handed to the browser
    // (publicUrl) and recognised again later (objectKeyFromUrl). Uploads and
    // deletes go to SupabaseEndpoint::serverBase() instead, which differs only
    // when SUPABASE_INTERNAL_URL is set.
    private function url(): string
    {
        return rtrim((string) config('supabase.url'), '/');
    }

    private function key(): string
    {
        return (string) config('supabase.service_role_key');
    }

    /**
     * The object key for one user's avatar.
     *
     * Keyed by user id and NOT by a random filename, so re-uploading replaces
     * the previous picture rather than accumulating an orphan per upload. The
     * extension is part of the key because Supabase serves the object with the
     * content type it was stored under, and a `.png` key holding a JPEG would
     * be served with the wrong one.
     */
    public function objectKey(int|string $userId, string $extension): string
    {
        $extension = strtolower(preg_replace('/[^a-zA-Z0-9]/', '', $extension) ?: 'jpg');

        return "avatars/{$userId}.{$extension}";
    }

    /**
     * Uploads (or replaces) one avatar and returns its public URL.
     *
     * @throws RuntimeException when Supabase is unreachable or refuses the
     *                          upload. Thrown rather than returned as false so
     *                          ProfileController cannot accidentally report a
     *                          success it did not get — telling somebody their
     *                          picture was saved when it was not is the exact
     *                          failure this whole change is about.
     */
    public function putAvatar(int|string $userId, UploadedFile $file): string
    {
        if (! $this->isConfigured()) {
            throw new RuntimeException(
                'Supabase Storage is not configured, so the profile picture could not be stored. '.
                "Set SUPABASE_AVATAR_BUCKET (and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) in this backend's .env. ".
                'See backend/.env.example.'
            );
        }

        $key = $this->objectKey($userId, $file->extension() ?: $file->getClientOriginalExtension());
        $contents = file_get_contents($file->getRealPath());

        if ($contents === false) {
            throw new RuntimeException('The uploaded file could not be read from temporary storage.');
        }

        $response = Http::withHeaders([
            'apikey' => $this->key(),
            'Authorization' => 'Bearer '.$this->key(),
            // Replace in place rather than 409-ing on the second upload. The
            // object key is deterministic per user, so without this every
            // change of picture after the first would fail.
            'x-upsert' => 'true',
            'Content-Type' => $file->getMimeType() ?: 'application/octet-stream',
            // A year is safe BECAUSE the frontend appends a cache-busting
            // version parameter after a successful upload (see
            // AuthContext.bumpAvatarVersion) — the URL the browser requests
            // changes even though the object key does not.
            'Cache-Control' => 'max-age=31536000',
        ])
            ->timeout(20)
            ->withBody($contents, $file->getMimeType() ?: 'application/octet-stream')
            ->post(SupabaseEndpoint::serverBase().'/storage/v1/object/'.$this->bucket().'/'.$key);

        if ($response->failed()) {
            // The status and Supabase's own message are included because they
            // are the difference between "the bucket does not exist" and "the
            // key is wrong", and an operator reading a 500 needs to know which.
            // The service-role key itself is never part of this string.
            throw new RuntimeException(sprintf(
                'Supabase Storage refused the upload (HTTP %d): %s. Check that the "%s" bucket exists and is public.',
                $response->status(),
                (string) ($response->json('message') ?? $response->json('error') ?? 'no message'),
                $this->bucket(),
            ));
        }

        return $this->publicUrl($key);
    }

    /**
     * Removes a stored object, best effort.
     *
     * Used when a new upload lands under a DIFFERENT key than the previous one
     * (someone replacing a PNG with a JPEG), which is the only case where the
     * old object is not simply overwritten. Failure is swallowed on purpose: an
     * orphaned old avatar costs a few kilobytes, and turning that into a failed
     * upload would deny somebody their new picture over a leftover file.
     */
    public function deleteObject(string $key): bool
    {
        if (! $this->isConfigured() || $key === '') {
            return false;
        }

        try {
            return Http::withHeaders([
                'apikey' => $this->key(),
                'Authorization' => 'Bearer '.$this->key(),
            ])
                ->timeout(10)
                ->delete(SupabaseEndpoint::serverBase().'/storage/v1/object/'.$this->bucket().'/'.$key)
                ->successful();
        } catch (\Throwable) {
            return false;
        }
    }

    /** The browser-facing URL of a stored object in the public bucket. */
    public function publicUrl(string $key): string
    {
        return $this->url().'/storage/v1/object/public/'.$this->bucket().'/'.ltrim($key, '/');
    }

    /**
     * Recovers the object key from a URL this service previously produced, or
     * null if the URL did not come from this bucket.
     *
     * Used to decide whether a stored avatar_path is a Supabase object that can
     * be deleted, as opposed to a legacy local-disk path or a URL from some
     * other origin that must be left alone.
     */
    public function objectKeyFromUrl(?string $url): ?string
    {
        if (! $url || ! $this->isConfigured()) {
            return null;
        }

        $prefix = $this->url().'/storage/v1/object/public/'.$this->bucket().'/';

        return str_starts_with($url, $prefix)
            ? substr($url, strlen($prefix))
            : null;
    }
}
