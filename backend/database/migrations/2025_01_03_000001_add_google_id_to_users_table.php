<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Phase 4 — Feature #3 (Google OAuth). Purely additive: existing users and
// the original users/is_active migrations are untouched. `google_id` links
// an application account to the Google account ("sub" claim, i.e. Google's
// stable numeric user id — never the email) that authenticated it.
//
// Nullable + unique: most accounts will never sign in with Google, and a
// unique constraint stops the same Google account from being linked to more
// than one application user.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('google_id')->nullable()->unique()->after('email');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('google_id');
        });
    }
};
