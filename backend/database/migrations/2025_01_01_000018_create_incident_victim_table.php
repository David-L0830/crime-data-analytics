<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// This is the "case_victims" relationship called for by the Victim
// Information spec — named incident_victim instead, to match this project's
// existing convention for the criminal<->case pivot (criminal_incident,
// added in 2025_01_01_000016_add_criminal_profile_fields): `incidents` is
// this project's case entity (case_number, crime_type/charge, status), so
// "case" and "incident" are the same table here. One row per (case, victim)
// pair — a case can have zero, one, or many victims, and the same victim can
// appear on more than one case, so this is many-to-many with no implicit
// 1:1 assumption either direction.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('incident_victim', function (Blueprint $table) {
            $table->id();
            $table->foreignId('incident_id')->constrained('incidents')->cascadeOnDelete();
            $table->foreignId('victim_id')->constrained('victims')->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['incident_id', 'victim_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('incident_victim');
    }
};
