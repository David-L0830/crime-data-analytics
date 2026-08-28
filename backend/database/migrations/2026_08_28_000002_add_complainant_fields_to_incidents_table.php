<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Separates the COMPLAINANT (the person who files the report) from the VICTIM
 * (the person the crime happened to). They are usually the same person, but
 * when the victim is hospitalised, a minor, or otherwise unable to report, the
 * complainant is somebody else — a parent, a relative, a neighbour — and the
 * blotter has to record who that was and how to reach them.
 *
 * These are real columns, not text appended to `description`, so the
 * relationship and contact number can be queried, validated and exported.
 *
 * Data preservation: every column is added nullable (or with a default), so
 * every existing incident row stays valid and untouched.
 * complainant_is_victim defaults to TRUE, which is the correct reading of a
 * legacy record: it names one victim and no separate complainant.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('incidents', function (Blueprint $table) {
            $table->boolean('complainant_is_victim')->default(true);
            $table->string('complainant_name', 150)->nullable();
            $table->string('complainant_relationship', 100)->nullable();
            $table->string('complainant_contact', 50)->nullable();
            $table->string('complainant_address', 255)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('incidents', function (Blueprint $table) {
            $table->dropColumn([
                'complainant_is_victim',
                'complainant_name',
                'complainant_relationship',
                'complainant_contact',
                'complainant_address',
            ]);
        });
    }
};
