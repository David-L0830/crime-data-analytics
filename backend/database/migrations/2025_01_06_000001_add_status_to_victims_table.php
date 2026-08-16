<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Checkpoint 20 — Delete → Archive migration (Task 8). Victims had no
// status column at all (confirmed against 2025_01_01_000017_create_victims_table.php).
// Adds one, following the exact same convention already used on
// `residents.status` (plain string column, no DB enum/check constraint,
// default 'Active'). Existing victim rows all receive the default
// 'Active' value automatically via the column default — none of them are
// marked Archived by this migration.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('victims', function (Blueprint $table) {
            $table->string('status')->default('Active')->after('address');
        });
    }

    public function down(): void
    {
        Schema::table('victims', function (Blueprint $table) {
            $table->dropColumn('status');
        });
    }
};
