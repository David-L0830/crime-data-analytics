<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Section 6 Phase 2 index audit: `incident_victim` has a UNIQUE composite
 * index on (incident_id, victim_id) from
 * 2025_01_01_000018_create_incident_victim_table, which only serves lookups
 * that filter on `incident_id` (its leading column). The application also
 * looks up in the reverse direction — Victim::relatedIncidents() eager-loads
 * with a `WHERE victim_id IN (...)` on every victims list/detail load — which
 * that composite index cannot serve efficiently.
 *
 * This adds a separate, single-column, non-unique index on `victim_id` only.
 * The existing composite unique index is untouched: not modified, not
 * dropped, not replaced.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('incident_victim', function (Blueprint $table) {
            $table->index('victim_id', 'incident_victim_victim_id_index');
        });
    }

    public function down(): void
    {
        Schema::table('incident_victim', function (Blueprint $table) {
            $table->dropIndex('incident_victim_victim_id_index');
        });
    }
};
