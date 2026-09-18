<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Temporary passwords for administrator-created accounts — Phase 1 (schema).
//
// An administrator may now create an account with a temporary password (see
// UserController::store). The password itself is set in Supabase Auth, which
// stays the only place any credential lives. These columns record the STATE
// around it, never the value:
//
//   must_change_password           the account still has an administrator-
//                                  issued password it has not replaced.
//   temporary_password_expires_at  when that temporary password stops being
//                                  acceptable to this application.
//   password_changed_at            when the account holder last replaced it.
//   temporary_password_issued_by   which administrator issued it.
//
// Deliberately absent: any column holding the password, its hash, its length,
// or any fragment of it. The legacy `password` column is untouched and stays
// NULL for every Supabase-era account.
//
// Existing accounts are unaffected: must_change_password defaults to false and
// every other column is NULL, so no current user is asked to do anything.
// Enforcement (the forced change on next sign-in) is a later phase; this
// migration only adds state that nothing reads yet.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('must_change_password')->default(false)->after('mfa_method');
            $table->timestamp('temporary_password_expires_at')->nullable()->after('must_change_password');
            $table->timestamp('password_changed_at')->nullable()->after('temporary_password_expires_at');
            $table->foreignId('temporary_password_issued_by')->nullable()->after('password_changed_at')
                ->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('temporary_password_issued_by');
            $table->dropColumn(['must_change_password', 'temporary_password_expires_at', 'password_changed_at']);
        });
    }
};
