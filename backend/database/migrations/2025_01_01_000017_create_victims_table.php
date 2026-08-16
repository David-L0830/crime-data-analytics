<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Victim Information (Criminal Records module extension): victims are their
// own entity, independent of any single criminal. They connect to criminals
// only indirectly, through the case (an `incidents` row — this project's
// existing case entity, identified by `case_number`) via the incident_victim
// pivot created in the next migration. A victim is never written directly
// onto a criminal record.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('victims', function (Blueprint $table) {
            $table->id();
            $table->string('victim_code')->unique();
            $table->string('full_name');
            $table->string('alias')->nullable();
            $table->string('gender')->nullable();
            $table->date('date_of_birth')->nullable();
            $table->string('civil_status')->nullable();
            $table->string('nationality')->nullable();
            $table->string('contact_number')->nullable();
            $table->string('address')->nullable();
            $table->timestamps();

            $table->index('full_name');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('victims');
    }
};
