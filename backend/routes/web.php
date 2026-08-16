<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return response()->json([
        'name' => config('app.name'),
        'status' => 'ok',
        'message' => 'BADAC CDARS API — see /api for endpoints.',
    ]);
});

// Google OAuth is handled entirely by Supabase Auth (frontend calls
// supabase.auth.signInWithOAuth({ provider: 'google' }) — see
// src/context/AuthContext.jsx). This backend has no OAuth callback route:
// the former Laravel/Socialite /auth/google/redirect and
// /auth/google/callback routes (and GoogleAuthController) were removed as
// part of the final Supabase-only auth migration — see
// AUTH_MIGRATION_STATUS.md.
