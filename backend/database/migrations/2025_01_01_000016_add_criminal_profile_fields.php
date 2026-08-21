<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Extends the Criminal Records schema for the full Criminal Profile view
// (Part I of the design spec): personal-info fields not previously captured,
// a structured physical description, and a many-to-many relationship to
// incidents so a criminal can have more than one related case instead of the
// single related_incident_id the schema had before. Existing data (including
// related_incident_id) is preserved and backfilled into the new pivot table
// rather than dropped.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('criminals', function (Blueprint $table) {
            $table->string('alias')->nullable()->after('full_name');
            $table->string('civil_status')->nullable()->after('gender');
            $table->string('nationality')->nullable()->after('civil_status');
            $table->string('contact_number')->nullable()->after('address');
            $table->string('sitio')->nullable()->after('address');
            $table->string('photo_path')->nullable()->after('sitio');

            // Structured physical description — physical_description (free text)
            // is kept for backward compatibility / migration of existing data.
            $table->string('height')->nullable()->after('physical_description');
            $table->string('weight')->nullable()->after('height');
            $table->string('build')->nullable()->after('weight');
            $table->string('hair_color')->nullable()->after('build');
            $table->string('eye_color')->nullable()->after('hair_color');
            $table->string('distinguishing_marks')->nullable()->after('eye_color');
        });

        Schema::create('criminal_incident', function (Blueprint $table) {
            $table->id();
            $table->foreignId('criminal_id')->constrained('criminals')->cascadeOnDelete();
            $table->foreignId('incident_id')->constrained('incidents')->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['criminal_id', 'incident_id']);
        });

        // Backfill: every criminal's existing single related_incident_id becomes
        // its first row in the new many-to-many pivot table.
        $rows = DB::table('criminals')->whereNotNull('related_incident_id')->get(['id', 'related_incident_id']);
        foreach ($rows as $row) {
            DB::table('criminal_incident')->insertOrIgnore([
                'criminal_id' => $row->id,
                'incident_id' => $row->related_incident_id,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('criminal_incident');

        Schema::table('criminals', function (Blueprint $table) {
            $table->dropColumn([
                'alias', 'civil_status', 'nationality', 'contact_number', 'sitio', 'photo_path',
                'height', 'weight', 'build', 'hair_color', 'eye_color', 'distinguishing_marks',
            ]);
        });
    }
};
