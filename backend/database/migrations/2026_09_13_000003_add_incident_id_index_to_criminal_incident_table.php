<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Section 6 Phase 2 index audit: `criminal_incident` has a UNIQUE composite
 * index on (criminal_id, incident_id) from
 * 2025_01_01_000016_add_criminal_profile_fields, which only serves lookups
 * that filter on `criminal_id` (its leading column). The application also
 * looks up in the reverse direction — Incident::relatedCriminals() is
 * eager-loaded transitively via VictimController's `relatedIncidents.
 * relatedCriminals`, running a `WHERE incident_id IN (...)` — which that
 * composite index cannot serve efficiently.
 *
 * This adds a separate, single-column, non-unique index on `incident_id`
 * only. The existing composite unique index is untouched: not modified, not
 * dropped, not replaced.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('criminal_incident', function (Blueprint $table) {
            $table->index('incident_id', 'criminal_incident_incident_id_index');
        });
    }

    public function down(): void
    {
        Schema::table('criminal_incident', function (Blueprint $table) {
            $table->dropIndex('criminal_incident_incident_id_index');
        });
    }
};
