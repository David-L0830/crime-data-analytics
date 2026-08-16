<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Checkpoint 3 of the incremental Sanctum -> Supabase Auth migration (see
// TODO.md / HANDOFF.md). Adds the stable-identifier column called for in
// the migration spec's "User Identity Mapping" section: rather than
// re-keying the users table (which would break every existing
// relationship — incidents, audit logs, role assignments), we link each
// existing application user to their future Supabase Auth identity by
// UUID, exactly as google_id already links a Google identity today.
//
// Purely additive: nullable, no default change to existing rows, no data
// loss, existing Sanctum-based login is completely unaffected by this
// migration on its own.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Supabase Auth's `sub` claim (a UUID). Nullable because no user
            // has one yet — they get linked the first time they sign in via
            // Supabase Auth with a verified email matching an existing
            // account (see App\Services\SupabaseTokenValidator), the same
            // "link by verified email, never auto-register" rule already
            // used for Google OAuth in this app.
            $table->uuid('supabase_user_id')->nullable()->unique()->after('google_id');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('supabase_user_id');
        });
    }
};
