<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Section 6 Phase 2 index audit: `category` is a real, repeated WHERE-column
 * (IncidentController::index() filter, ReportGenerator::incidentRows() report
 * filter) that was never covered by an index — unlike the other filterable
 * incidents columns (`sitio`, `crime_type`, `status`, `incident_date`), which
 * already have one from 2025_01_01_000010_create_incidents_table.
 *
 * Purely additive: adds one non-unique B-tree index, no column/constraint
 * change, no data change.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('incidents', function (Blueprint $table) {
            $table->index('category', 'incidents_category_index');
        });
    }

    public function down(): void
    {
        Schema::table('incidents', function (Blueprint $table) {
            $table->dropIndex('incidents_category_index');
        });
    }
};
