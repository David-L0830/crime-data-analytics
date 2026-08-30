<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which roles a notification is FOR.
 *
 * Notifications are shared announcements, but not every announcement is
 * relevant to every account. "Criminal record CR-0012 was added" is useful to
 * an Administrator and to BADAC (read-only), both of whom can open Records;
 * an Encoder has no access to that module at all, so for them the notification
 * is not merely noise — clicking it lands on a route their role is bounced off.
 *
 * Stored as a comma-delimited list wrapped in delimiters (",badac_admin,")
 * rather than JSON, so the "does this list contain this role" test is one
 * portable LIKE '%,role,%' that behaves identically on PostgreSQL (production)
 * and SQLite (tests), with no driver-specific JSON operators.
 *
 * NULL means "every authenticated role", which is both the column default and
 * the value every pre-existing row keeps — so no existing notification changes
 * who can see it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('app_notifications', function (Blueprint $table) {
            $table->string('audience_roles')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('app_notifications', function (Blueprint $table) {
            $table->dropColumn('audience_roles');
        });
    }
};
