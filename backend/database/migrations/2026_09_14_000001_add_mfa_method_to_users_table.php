<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Per-account choice of second-factor METHOD.
 *
 * NULL is the default and means "no alternative method" — the account is
 * handled exactly as before: Supabase TOTP, enforced from the signed JWT `aal`
 * claim (see EnsureSupabaseAal2). The only other value is 'email_otp', which
 * must be set deliberately for a specific account; nothing infers it from the
 * account having an email address.
 *
 * This column says HOW an owed second factor may be satisfied, never WHETHER
 * one is owed. The obligation is still the existing Supabase-side
 * `app_metadata.mfa_required` flag (see SupabaseAdminService::setMfaRequired),
 * so there is one source of truth for "required" and this adds no second one.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('mfa_method', 20)->nullable()->after('supabase_user_id');
        });

        // SQLite (the test database) cannot add a CHECK constraint to an
        // existing table; PostgreSQL enforces the allowed values at rest.
        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE users ADD CONSTRAINT users_mfa_method_check CHECK (mfa_method IS NULL OR mfa_method IN ('email_otp'))");
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_mfa_method_check');
        }

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('mfa_method');
        });
    }
};
