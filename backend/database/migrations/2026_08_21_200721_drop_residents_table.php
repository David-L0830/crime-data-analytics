<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Resident Registry module cleanup — the frontend module was removed in an
// earlier checkpoint (see src/utils/constants.js comments referencing
// "Checkpoint 28"); this migration finishes that removal on the backend by
// dropping the now-orphaned `residents` table. No other table has a
// foreign key into `residents` (verified via full-schema grep before
// writing this migration), so this drop cannot cascade or break any other
// data. A full row-level backup was taken to residents_backup.json before
// this migration ran — see project chat history / repo root for that file
// if the dropped data ever needs to be reviewed. down() below recreates
// the empty table structure only; it does NOT restore the original rows.
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('residents');
    }

    public function down(): void
    {
        Schema::create('residents', function (Blueprint $table) {
            $table->id();
            $table->string('resident_code')->unique();
            $table->string('first_name');
            $table->string('last_name');
            $table->date('date_of_birth')->nullable();
            $table->string('gender')->nullable();
            $table->string('civil_status')->nullable();
            $table->string('occupation')->nullable();
            $table->string('sitio')->nullable();
            $table->string('street')->nullable();
            $table->string('contact_number')->nullable();
            $table->string('status')->default('Active');
            $table->timestamps();

            $table->index(['last_name', 'first_name']);
            $table->index('sitio');
        });
    }
};
