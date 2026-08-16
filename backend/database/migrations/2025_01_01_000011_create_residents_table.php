<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('residents', function (Blueprint $table) {
            $table->id();
            // `id` is the unique identifier; resident_code is a display-only
            // reference (RES-0001). Full names are intentionally NOT unique —
            // residents may legitimately share the same name (see task spec
            // "Duplicate Name Handling").
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

    public function down(): void
    {
        Schema::dropIfExists('residents');
    }
};
