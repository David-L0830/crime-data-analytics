<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Server-side state for email one-time-code MFA (see EmailMfaService).
 *
 * Two tables, because they hold two different facts with different lifetimes:
 *
 *   email_mfa_challenges         - a code that has been SENT and may still be
 *                                  entered. Minutes long. Holds only an HMAC
 *                                  of the code, never the code itself.
 *   email_mfa_verified_sessions  - a Supabase session that has ENTERED a
 *                                  correct code. Holds no secret at all.
 *
 * Both are keyed on (user_id, supabase_session_id). `supabase_session_id` is
 * the signed `session_id` claim of the Supabase access token, so a code sent
 * to, or verified by, one session means nothing to any other session of the
 * same account. The unique index is what makes "one active challenge per
 * session" a property of the schema rather than of the code.
 *
 * Rows are deleted on logout and pruned on the next send once expired or
 * consumed; nothing here is meant to be retained as history. The LOGIN/LOGOUT
 * audit trail already lives in audit_logs.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('email_mfa_challenges', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('supabase_session_id', 64);
            // hex HMAC-SHA256 — always 64 characters.
            $table->char('code_hash', 64);
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->timestamp('expires_at');
            $table->timestamp('consumed_at')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'supabase_session_id']);
            $table->index('expires_at');
        });

        Schema::create('email_mfa_verified_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('supabase_session_id', 64);
            $table->timestamp('verified_at');
            $table->timestamp('expires_at');
            $table->timestamps();

            $table->unique(['user_id', 'supabase_session_id']);
            $table->index('expires_at');
        });

        $this->enableRowLevelSecurity();
    }

    /**
     * These tables live in `public`, which Supabase's Data API (PostgREST)
     * exposes to the `anon` and `authenticated` roles. Without RLS, anyone
     * holding the publishable key could read challenge hashes or — far worse —
     * INSERT a row into email_mfa_verified_sessions for their own session and
     * skip the second factor entirely. RLS with no policies denies both roles
     * everything, while Laravel's owner connection is unaffected. Same pattern
     * as the report_schedules migration.
     */
    private function enableRowLevelSecurity(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        foreach (['email_mfa_challenges', 'email_mfa_verified_sessions'] as $table) {
            DB::statement("ALTER TABLE public.\"{$table}\" ENABLE ROW LEVEL SECURITY");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('email_mfa_verified_sessions');
        Schema::dropIfExists('email_mfa_challenges');
    }
};
