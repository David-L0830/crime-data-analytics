<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Archive → Restore for Criminal and Victim records.
//
// Archiving currently overwrites `status` with 'Archived', which destroys the
// meaningful pre-archive value — a criminal who was 'Wanted' or 'Incarcerated'
// becomes indistinguishable from any other archived record, and there is no
// way back. Nothing in the schema preserved that value: audit_logs has no
// target_id and no status column (see 2025_01_01_000013), its description is
// only "Archived criminal record {name}", and criminals.full_name is
// deliberately not unique (see 2025_01_01_000012) — so reconstructing the
// original status from the audit trail would be guesswork, not restoration.
//
// `previous_status` is therefore written by the archive endpoints and read
// back by the restore endpoints, making the round trip deterministic from the
// row itself.
//
// Purely additive: nullable, no default, no backfill, no change to the
// existing `status` columns or their 'Active' defaults, and no existing row is
// rewritten. Every current row correctly gets null, because production holds
// zero archived criminals and zero archived victims — verified before writing
// this migration, and consistent with audit_logs containing no ARCHIVE event
// for module 'criminal-records'.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('criminals', function (Blueprint $table) {
            $table->string('previous_status')->nullable()->after('status');
        });

        Schema::table('victims', function (Blueprint $table) {
            $table->string('previous_status')->nullable()->after('status');
        });
    }

    public function down(): void
    {
        Schema::table('criminals', function (Blueprint $table) {
            $table->dropColumn('previous_status');
        });

        Schema::table('victims', function (Blueprint $table) {
            $table->dropColumn('previous_status');
        });
    }
};
