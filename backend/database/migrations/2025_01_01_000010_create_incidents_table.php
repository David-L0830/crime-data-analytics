<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('incidents', function (Blueprint $table) {
            $table->id();
            // incident_code / case_number are the human-facing identifiers the
            // existing UI displays (INC-00001 / CN-2025-0001) — `id` remains the
            // real primary key so records are never matched or deduped by name.
            $table->string('incident_code')->unique();
            $table->string('case_number')->unique();
            $table->string('crime_type');
            $table->string('category')->nullable();
            $table->date('incident_date');
            $table->time('incident_time')->nullable();
            $table->string('street')->nullable();
            $table->string('sitio')->nullable();
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();

            $table->string('victim_name')->nullable();
            $table->unsignedTinyInteger('victim_age')->nullable();
            $table->string('victim_gender')->nullable();

            $table->string('suspect_name')->nullable();
            $table->unsignedTinyInteger('suspect_age')->nullable();

            $table->string('reporting_officer')->nullable();
            $table->string('investigating_officer')->nullable();
            $table->string('badge_number')->nullable();
            $table->string('unit')->nullable();

            $table->string('status')->default('Open');
            $table->string('priority')->default('Normal');
            $table->text('description')->nullable();
            $table->string('evidence')->nullable();

            $table->foreignId('reported_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('synced_at')->nullable();
            $table->timestamps();

            $table->index('sitio');
            $table->index('crime_type');
            $table->index('status');
            $table->index('incident_date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('incidents');
    }
};
