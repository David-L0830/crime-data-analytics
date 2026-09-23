<?php

namespace App\Support;

/**
 * The two addresses of the Supabase project (see config/supabase.php).
 *
 *   publicBase()  SUPABASE_URL — what tokens are issued under and what a
 *                 browser can reach. Used for the `iss` check and for any URL
 *                 handed to the frontend.
 *   serverBase()  SUPABASE_INTERNAL_URL when set, otherwise SUPABASE_URL —
 *                 where this backend itself sends requests.
 *
 * With SUPABASE_INTERNAL_URL unset (every hosted environment) both return the
 * same value, so nothing changes.
 */
final class SupabaseEndpoint
{
    public static function publicBase(): string
    {
        return rtrim((string) config('supabase.url'), '/');
    }

    public static function serverBase(): string
    {
        $internal = rtrim((string) config('supabase.internal_url'), '/');

        return $internal !== '' ? $internal : self::publicBase();
    }
}
