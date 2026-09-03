<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Archive -> Restore for Incidents, matching
// 2026_08_26_000001_add_previous_status_to_criminals_and_victims.php exactly.
//
// IncidentController::archive() already overwrites `status` with 'Archived',
// which destroys the meaningful pre-archive value (Open, Under Investigation,
// Solved, Closed) — unlike Criminal/Victim, Incident never got the same
// previous_status/restore() treatment in that earlier migration, so an
// archived incident had no way back except the general PUT /incidents/{id}
// update endpoint, which bypasses the archive/restore audit trail entirely.
//
// Purely additive: nullable, no default, no backfill, no change to the
// existing `status` column or its 'Open' default, and no existing row is
// rewritten.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('incidents', function (Blueprint $table) {
            $table->string('previous_status')->nullable()->after('status');
        });
    }

    public function down(): void
    {
        Schema::table('incidents', function (Blueprint $table) {
            $table->dropColumn('previous_status');
        });
    }
};
