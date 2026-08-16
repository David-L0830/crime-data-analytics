<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Phase 4 — Admin User Management: adds an account-status flag so the
// BADAC Administrator can deactivate an account (e.g. Encoder leaves the
// barangay) without deleting their historical incident records, which are
// still referenced via incidents.reported_by / audit_logs.user_id.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('is_active')->default(true)->after('role');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('is_active');
        });
    }
};
