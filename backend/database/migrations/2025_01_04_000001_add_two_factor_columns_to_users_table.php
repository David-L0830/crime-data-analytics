<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Phase 4 — Feature #4 (TOTP Two-Factor Authentication). Purely additive,
// same pattern as the is_active/google_id migrations: existing users and
// prior migrations are untouched.
//
// - two_factor_secret: the TOTP shared secret (base32). Encrypted at the
//   Eloquent-cast layer (see User::casts()) using APP_KEY, so even a raw DB
//   read/leak doesn't expose usable secrets. Set on setup, cleared on
//   disable. Nullable because most accounts will never enable 2FA.
// - two_factor_recovery_codes: JSON array of *hashed* one-time recovery
//   codes (see TwoFactorController). Also encrypted at rest, on top of each
//   individual code already being hashed — belt and suspenders, since a
//   recovery code is effectively a backup password.
// - two_factor_confirmed_at: null until the user proves possession of the
//   secret by submitting one valid TOTP code (see TwoFactorController::confirm).
//   This column — not two_factor_secret being non-null — is the source of
//   truth for "2FA is enabled" (User::hasTwoFactorEnabled()), so a setup
//   that was started but never confirmed never blocks login.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->text('two_factor_secret')->nullable()->after('google_id');
            $table->text('two_factor_recovery_codes')->nullable()->after('two_factor_secret');
            $table->timestamp('two_factor_confirmed_at')->nullable()->after('two_factor_recovery_codes');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['two_factor_secret', 'two_factor_recovery_codes', 'two_factor_confirmed_at']);
        });
    }
};
