<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('criminals', function (Blueprint $table) {
            $table->id();
            $table->string('criminal_code')->unique();
            // full_name is deliberately NOT unique/primary — see residents migration.
            $table->string('full_name');
            $table->date('date_of_birth')->nullable();
            $table->string('gender')->nullable();
            $table->string('address')->nullable();
            $table->string('physical_description')->nullable();
            $table->string('status')->default('Active');
            $table->json('charges')->nullable();
            $table->text('notes')->nullable();
            $table->foreignId('related_incident_id')->nullable()->constrained('incidents')->nullOnDelete();
            $table->string('related_case_number')->nullable();
            $table->timestamps();

            $table->index('full_name');
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('criminals');
    }
};
