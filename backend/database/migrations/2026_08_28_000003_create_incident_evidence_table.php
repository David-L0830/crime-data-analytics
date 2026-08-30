<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Evidence becomes a structured, repeatable record (Evidence ID + Description)
 * instead of one free-text `incidents.evidence` string that could only ever
 * hold a single unlabelled sentence.
 *
 * DATA PRESERVATION — this is the important part of this migration:
 *
 *  - incidents.evidence is NOT dropped. The column and every value in it stay
 *    exactly where they are, so nothing is lost and a rollback is trivial.
 *  - Every incident that has a non-empty evidence string gets one
 *    incident_evidence row (EV-001) carrying that exact text as its
 *    description, so existing evidence appears in the new UI instead of
 *    silently disappearing.
 *  - down() removes only the new table, never the original column.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('incident_evidence', function (Blueprint $table) {
            $table->id();
            $table->foreignId('incident_id')->constrained('incidents')->cascadeOnDelete();
            // Human-facing reference ("EV-001", "CCTV-2026-04"). Unique within
            // a case, not globally: two unrelated cases may each label their
            // first item EV-001, and forcing global uniqueness would make that
            // ordinary situation an error.
            $table->string('evidence_code', 50);
            $table->text('description');
            $table->timestamps();

            $table->unique(['incident_id', 'evidence_code']);
            $table->index('incident_id');
        });

        // Backfill: carry the legacy single-string evidence across.
        DB::table('incidents')
            ->select('id', 'evidence')
            ->whereNotNull('evidence')
            ->where('evidence', '!=', '')
            ->orderBy('id')
            ->chunk(200, function ($incidents) {
                $rows = [];
                foreach ($incidents as $incident) {
                    $text = trim((string) $incident->evidence);
                    if ($text === '') {
                        continue;
                    }
                    $rows[] = [
                        'incident_id' => $incident->id,
                        'evidence_code' => 'EV-001',
                        'description' => $text,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ];
                }
                if ($rows) {
                    DB::table('incident_evidence')->insert($rows);
                }
            });
    }

    public function down(): void
    {
        Schema::dropIfExists('incident_evidence');
    }
};
