<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// The BADAC role is renamed from badac_readonly to badac_validator: the same
// accounts, which now also validate records (see User::ROLE_BADAC_VALIDATOR).
//
// DATA ONLY. No column, index or constraint changes; `users.role` and
// `app_notifications.audience_roles` are plain strings. Exactly two kinds of
// value change, and nothing else:
//
//   users.role                      'badac_readonly'  -> 'badac_validator'
//                                   (exact match only; 'badac_admin' and
//                                   'encoder' rows are not in the WHERE)
//   app_notifications.audience_roles  the comma-anchored token
//                                   ',badac_readonly,' -> ',badac_validator,'
//                                   inside the list (e.g. ",badac_admin,
//                                   badac_readonly," becomes ",badac_admin,
//                                   badac_validator,"). NULL audiences ("every
//                                   role") are untouched. The commas are what
//                                   stop the match from touching any other
//                                   token — the same anchoring
//                                   AppNotification::scopeForRole() relies on.
//
// Neither update sets updated_at: renaming a role is not an edit a user made,
// and an account's "last updated" must not claim otherwise.
//
// REPLACE() behaves identically on PostgreSQL (production) and SQLite (tests).
//
// down() is the exact inverse. It also reverts any account created as
// badac_validator after up() ran, which is intended: the code that down()
// returns to knows only badac_readonly, and would otherwise lock that account
// out of every route.
return new class extends Migration
{
    public function up(): void
    {
        $this->rename('badac_readonly', 'badac_validator');
    }

    public function down(): void
    {
        $this->rename('badac_validator', 'badac_readonly');
    }

    private function rename(string $from, string $to): void
    {
        DB::transaction(function () use ($from, $to) {
            DB::table('users')
                ->where('role', $from)
                ->update(['role' => $to]);

            DB::table('app_notifications')
                ->where('audience_roles', 'like', '%,'.$from.',%')
                ->update([
                    'audience_roles' => DB::raw(
                        'REPLACE(audience_roles, '
                        .DB::getPdo()->quote(','.$from.',').', '
                        .DB::getPdo()->quote(','.$to.',').')'
                    ),
                ]);
        });
    }
};
