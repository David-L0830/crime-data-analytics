<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-user read state for app notifications.
 *
 * app_notifications rows are system-wide announcements ("Case CN-2025-0032 was
 * logged in Sitio 4") with no owner column, and until now the read flag was
 * system-wide too: whoever opened the bell first marked the notification read
 * for EVERY user, and the next person's unread count silently dropped to zero
 * for messages they had never seen.
 *
 * This table records "user U has read notification N". The announcement stays
 * shared; only the read state is personal, which is what makes the bell count
 * correct for the signed-in user and keeps one account from mutating another
 * account's inbox.
 *
 * Data preservation: the legacy app_notifications.read column is left in place
 * and is still honoured — a notification already flagged read before this
 * change continues to read as read for everyone, so no existing inbox suddenly
 * refills with old messages.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notification_reads', function (Blueprint $table) {
            $table->id();
            $table->foreignId('app_notification_id')->constrained('app_notifications')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamp('read_at');

            $table->unique(['app_notification_id', 'user_id']);
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notification_reads');
    }
};
