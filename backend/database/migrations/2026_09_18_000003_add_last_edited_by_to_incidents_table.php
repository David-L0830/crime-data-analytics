<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Who last edited an incident's content.
 *
 * Validation is a second pair of eyes, and IncidentController::approve()
 * already refuses to let a record's submitter approve it (reported_by). That
 * closes one route to a self-approval and leaves the other open: an
 * Administrator holds edit_any_record, so they can rewrite somebody else's
 * record and then validate their own words. Nothing in this database could
 * detect that, because nothing recorded who edited what.
 *
 * WHY A COLUMN AND NOT audit_logs. audit_logs already records that an UPDATE
 * happened and by whom, but it cannot say WHICH incident: it has no target_id,
 * and its only link to a record is a case number interpolated into the
 * free-text description. case_number is editable, so an edit can change the
 * very token a lookup would depend on. An authorization decision must not rest
 * on parsing a log written for humans to read.
 *
 * WHAT IT MEANS: the last authenticated user to substantively edit the
 * incident's CONTENT — that is, IncidentController::update(), which is also
 * the path an Encoder's correction takes. Deliberately NOT written by
 * approve(), returnForCorrection(), archive() or restore(): those change
 * workflow or lifecycle state, not the content a reviewer assesses, and each
 * already records its own actor (validated_by, returned_by). Writing it in
 * approve() in particular would make every reviewer the last editor and defeat
 * the rule this column exists to serve.
 *
 * The name is deliberate. `updated_by` would read as the partner of
 * updated_at, which changes on every write including validation and archiving;
 * this column tracks something narrower, and is named for it.
 *
 * NO BACKFILL. Existing rows stay null, and null means "no edit has been
 * recorded since this column existed" — never "nobody", and never a match for
 * the person asking to validate. There is no honest source to backfill from
 * (see the audit_logs note above), and copying reported_by would assert that
 * every creator was also the last editor, retroactively blocking them from
 * validating records they never touched after filing.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('incidents', function (Blueprint $table) {
            // Same shape as reported_by, validated_by and returned_by: a
            // nullable reference that survives the account being deleted. A
            // removed user must not take the incident with them, and must not
            // leave a dangling id that could later be reissued and match a
            // different person.
            $table->foreignId('last_edited_by')->nullable()->after('reported_by')
                ->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('incidents', function (Blueprint $table) {
            // Drops the foreign key and the column, and nothing else. Every
            // other validation and identity column on this table predates this
            // migration and is not its to remove.
            $table->dropConstrainedForeignId('last_edited_by');
        });
    }
};
