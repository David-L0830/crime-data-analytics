<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Cumulative brute-force budget for email MFA codes (audit finding M1).
 *
 * THE GAP THIS CLOSES
 *
 * email_mfa_challenges.attempts caps wrong guesses at five PER CODE, but
 * EmailMfaService::sendCode() replaces the row for a session and resets
 * attempts to zero. So the five-guess ceiling was never a ceiling: an attacker
 * holding the password could resend and get five fresh guesses, indefinitely.
 * The send limiter (1/minute, 5/hour per user) bounded the RATE at roughly 25
 * guesses an hour, but nothing bounded the TOTAL, so guesses simply accumulated
 * for as long as the attacker was patient.
 *
 * WHAT THIS TABLE HOLDS
 *
 * One row per user: how many wrong codes that account has submitted, and when
 * the current counting window opened. It deliberately survives everything the
 * attacker controls — resending a code, signing out, starting a new Supabase
 * session — because each of those was otherwise a way to wipe the count.
 *
 * WHY A ROLLING WINDOW RATHER THAN A PERMANENT COUNTER
 *
 * A counter that only ever goes up eventually locks out a legitimate person
 * who fat-fingered codes months apart, with no way back in: they cannot pass
 * MFA, and MFA is what the application requires. The window gives a bounded,
 * self-healing recovery path — wait it out — while still denying an attacker
 * the unbounded accumulation that made the original ceiling meaningless.
 *
 * WHY ONE ROW PER USER AND NOT AN AUDIT TRAIL
 *
 * This is an enforcement counter, not history. audit_logs already records
 * security-relevant events, and a row-per-failure table would be an
 * attacker-growable store. One row per user is bounded by the number of
 * accounts, and is deleted outright on a successful verification.
 *
 * RLS, AS EVERY TABLE IN public MUST
 *
 * Enabled here with no policies, the deny-all posture 2026_09_14_000003
 * established: Supabase exposes public through PostgREST, and this table
 * decides whether someone is locked out. Write access to it from the Data API
 * would let an attacker zero their own failure count. RowLevelSecurityTest
 * enforces this for every table, so a missing line here fails that test.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('email_mfa_failure_windows', function (Blueprint $table) {
            $table->id();

            // One row per account, and it disappears with the account.
            $table->foreignId('user_id')->unique()->constrained('users')->cascadeOnDelete();

            // Wrong codes submitted inside the current window. Capped in
            // EmailMfaService; smallint is far more headroom than the limit.
            $table->unsignedSmallInteger('failures')->default(0);

            // When the current window opened. The window rolls forward only
            // when a failure arrives after it has elapsed, never on a resend.
            $table->timestamp('window_started_at');

            $table->timestamps();
        });

        $this->enableRowLevelSecurity();
    }

    public function down(): void
    {
        Schema::dropIfExists('email_mfa_failure_windows');
    }

    private function enableRowLevelSecurity(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('ALTER TABLE public."email_mfa_failure_windows" ENABLE ROW LEVEL SECURITY');
    }
};
