<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Record validation by the BADAC Administrator.
//
// A new incident is no longer an official record the moment it is saved: it
// enters as 'pending', and an Administrator either validates it or returns it
// for correction (see IncidentController::approve()/returnForCorrection()).
//
// This is a SEPARATE axis from `status`. `status` describes the case (Open,
// Under Investigation, Solved, Closed, Archived); validation describes whether
// the record itself has been reviewed. Folding the two into one column would
// force a choice between "Solved" and "Validated" for the same row.
//
// EXISTING ROWS
//
// Every incident already in the table was entered, reviewed and reported on
// before this workflow existed, and the Dashboard, Metabase and every export
// already treat it as an official record. Marking those rows 'pending' would
// silently reclassify the barangay's entire history as unreviewed, so they are
// backfilled to 'validated' instead. They keep validated_by and validated_at
// NULL on purpose: that is what distinguishes "validated before the workflow
// existed" from "validated by a named Administrator on a known date", and the
// UI says so rather than inventing a validator.
//
// The column DEFAULT is 'pending', not 'validated', so a row written by any
// path other than this application (a seeder, a manual insert) starts
// unreviewed rather than silently official.
//
// Purely additive: no existing column is altered and no case data is changed.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('incidents', function (Blueprint $table) {
            $table->string('validation_status', 32)->default('pending')->after('previous_status');
            $table->foreignId('validated_by')->nullable()->after('validation_status')
                ->constrained('users')->nullOnDelete();
            $table->timestamp('validated_at')->nullable()->after('validated_by');
            $table->foreignId('returned_by')->nullable()->after('validated_at')
                ->constrained('users')->nullOnDelete();
            $table->timestamp('returned_at')->nullable()->after('returned_by');
            $table->text('correction_reason')->nullable()->after('returned_at');

            $table->index('validation_status');
        });

        // Historical records: see the note above.
        DB::table('incidents')->update(['validation_status' => 'validated']);
    }

    public function down(): void
    {
        Schema::table('incidents', function (Blueprint $table) {
            $table->dropIndex(['validation_status']);
            $table->dropConstrainedForeignId('validated_by');
            $table->dropConstrainedForeignId('returned_by');
            $table->dropColumn(['validation_status', 'validated_at', 'returned_at', 'correction_reason']);
        });
    }
};
