<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Final auth migration — Supabase Auth is now the only authentication
// system this application has (see AUTH_MIGRATION_STATUS.md). Two changes:
//
// 1. personal_access_tokens — this table exists exclusively for Laravel
//    Sanctum (created by Sanctum's own publishable migration back when the
//    package was installed). Nothing else in this schema references it —
//    verified via full-repo grep before writing this migration — and the
//    laravel/sanctum package itself has been removed from composer.json,
//    so nothing could create/read a row here even if one existed. Safe to
//    drop outright, unlike the columns below.
//
// 2. users.password — made nullable rather than dropped. New accounts
//    never get a Laravel password anymore (User::$fillable no longer
//    includes it; UserSeeder no longer sets it — provisioning now happens
//    in Supabase Auth, matched into this table by email on first sign-in,
//    see SupabaseTokenValidator), so it must be possible to insert a user
//    row without one. Existing rows keep whatever hash they already had —
//    deliberately NOT cleared/dropped here, since that's real user data
//    this migration cannot fully verify is safe to destroy in every
//    deployment of this codebase, and the column is already unreachable
//    for authentication (no route reads it — AuthController has no
//    login() method) so leaving it is inert, not a security exposure.
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('personal_access_tokens');

        Schema::table('users', function (Blueprint $table) {
            $table->string('password')->nullable()->change();
        });
    }

    public function down(): void
    {
        // Sanctum's own migration is gone (package removed), so recreating
        // personal_access_tokens exactly is out of scope for a down() here
        // — if this needs to be rolled back, reinstall laravel/sanctum
        // first and republish its migration.
        Schema::table('users', function (Blueprint $table) {
            $table->string('password')->nullable(false)->change();
        });
    }
};
