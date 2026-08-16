<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

// Checkpoint 6 / 6C — Supabase MFA coexistence.
//
// Gates a route on the current Supabase session's verified `aal` claim.
// The only source of truth this middleware ever reads is the
// 'supabase_aal' request attribute set by
// SupabaseTokenValidator::resolveUser() *after* it has already verified
// the JWT's signature, audience, and issuer — nothing here is derived
// from anything client-controlled (no request body field, no header
// Laravel didn't itself put there, no localStorage/React state, which
// obviously never reaches the backend at all).
//
// Every route this middleware is applied to uses the 'supabase' guard only
// (see routes/api.php — 'auth:supabase', never a multi-guard list). Because
// of that, "no 'supabase_aal' attribute at all" should never occur for an
// authenticated request in the first place: the preceding 'auth:supabase'
// middleware already rejects anything it can't resolve to a verified
// Supabase JWT.
//
// FAIL-CLOSED (Checkpoint 6C fix): this middleware previously let a request
// through when 'supabase_aal' was absent but $request->user() was somehow
// already set (e.g. a guard other than 'supabase' populating the user, or
// any future code path that resolves a user without going through
// SupabaseTokenValidator). That was fail-OPEN defense-in-depth — an
// unverified assurance level was treated as implicitly sufficient. It no
// longer is: absence of 'supabase_aal' is now rejected unconditionally,
// with the same 401 whether or not $request->user() happens to be set.
//
//   1. No 'supabase_aal' attribute -> reject with 401, regardless of
//      $request->user(). We cannot know the caller's assurance level, so we
//      must not assume it is sufficient.
//   2. 'supabase_aal' attribute present but != 'aal2' -> reject with a
//      distinguishable {mfaRequired: true} body so the frontend can route
//      to a step-up screen instead of a generic auth failure.
//   3. 'supabase_aal' === 'aal2' -> allow.
class EnsureSupabaseAal2
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->attributes->has('supabase_aal')) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if ($request->attributes->get('supabase_aal') !== 'aal2') {
            return response()->json([
                'mfaRequired' => true,
                'message' => 'This action requires a completed second-factor sign-in.',
            ], 401);
        }

        return $next($request);
    }
}
