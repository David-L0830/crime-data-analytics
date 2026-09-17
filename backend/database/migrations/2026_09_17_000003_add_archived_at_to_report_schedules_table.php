<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Archive, not delete, for report schedules (Reports module, Phase 2).
 *
 * A report schedule is no longer permanently deleted. It is archived: the row,
 * its configuration and its delivery history all stay, it simply stops being
 * listed as active and stops being eligible to send. ReportSchedule uses
 * Laravel SoftDeletes with THIS column as its deleted-at column, so every
 * normal query — the hourly command, the dispatcher, route-model binding for
 * edit and Run Now — excludes an archived schedule by default.
 *
 * TWO INDEPENDENT STATES, ON PURPOSE
 *
 *   is_active    paused / active      (unchanged)
 *   archived_at  archived / not       (this column)
 *
 * Archiving never touches is_active, so restoring returns a schedule to
 * exactly the pause state it had.
 *
 * Nullable, no default: every existing row is left NOT archived, so the
 * schedules that exist today keep running exactly as before.
 *
 * No archived_by column: the audit log already records who archived or
 * restored a schedule, and when.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('report_schedules', function (Blueprint $table) {
            $table->timestamp('archived_at')->nullable()->after('is_active');
        });
    }

    /**
     * SAFE ROLLBACK. Once the column is gone nothing distinguishes an archived
     * schedule from a live one, so a schedule that was archived while active
     * would start emailing crime records again the next hour. Before dropping
     * the column, every archived row is therefore PAUSED. After a rollback
     * those schedules show as paused, which an administrator can review and
     * resume deliberately — the recoverable direction.
     */
    public function down(): void
    {
        DB::table('report_schedules')
            ->whereNotNull('archived_at')
            ->update(['is_active' => false]);

        Schema::table('report_schedules', function (Blueprint $table) {
            $table->dropColumn('archived_at');
        });
    }
};
