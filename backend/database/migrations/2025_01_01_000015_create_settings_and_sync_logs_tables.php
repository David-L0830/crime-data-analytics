<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('settings', function (Blueprint $table) {
            $table->id();
            $table->string('barangay')->default('Barangay 178');
            $table->unsignedInteger('population')->nullable();
            $table->unsignedInteger('threshold')->default(5);
            $table->unsignedInteger('hotspot_threshold')->default(3);
            $table->json('categories')->nullable();
            $table->timestamps();
        });

        // Required by the existing frontend's sync-status widgets on the
        // Dashboard/Settings pages (getLastSync / getTodayImportedCount, etc).
        Schema::create('sync_logs', function (Blueprint $table) {
            $table->id();
            $table->string('status')->default('completed'); // completed | failed
            $table->unsignedInteger('records_received')->default(0);
            $table->string('source')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_logs');
        Schema::dropIfExists('settings');
    }
};
