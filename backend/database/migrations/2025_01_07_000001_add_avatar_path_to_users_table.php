<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Checkpoint 25 — Sidebar / Profile Settings. Adds storage for a self-
// uploaded avatar image. Nullable: when absent, UserResource keeps
// falling back to the existing initial-letter avatar (see UserResource's
// `avatarUrl` vs `avatar` fields) — no existing account is affected until
// it explicitly uploads a picture via ProfileController::avatar().
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('avatar_path')->nullable()->after('is_active');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('avatar_path');
        });
    }
};
