<?php

namespace Database\Seeders;

use App\Models\User;
use App\Support\Audit;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

// The one way a Super Administrator account comes into existence.
//
// No API route or screen can create or promote one (see
// User::ROLE_SUPER_ADMIN), so it is provisioned here, from the command line,
// by whoever operates the deployment:
//
//   php artisan db:seed --class=SuperAdminSeeder
//
// Deliberately NOT called from DatabaseSeeder. That seeds demo data, and the
// most privileged account in the system must never appear as a side effect of
// it.
//
// The identity comes from config/super_admin.php (SUPER_ADMIN_NAME,
// SUPER_ADMIN_USERNAME, SUPER_ADMIN_EMAIL). Like UserSeeder, this writes the
// local row only. The matching Supabase Auth user must be created in the
// Supabase Dashboard with the same email; nothing here contacts Supabase, so
// running it can never reach an identity provider by accident.
//
// Safe to run again: it updates the same Super Administrator's name and
// username. It REFUSES, and changes nothing, when the email or username
// already belongs to any other kind of account. Turning an existing account
// into a Super Administrator is exactly the escalation User Management is
// barred from, and a seeder must not be a quieter way to do it.
//
// MFA is mandatory for every account. This one is configured for Email OTP
// (users.mfa_method), which EnsureSupabaseAal2 enforces at every sign-in
// independently of anything held in Supabase, so the account is protected
// from its very first sign-in, before any authenticator could be enrolled.
class SuperAdminSeeder extends Seeder
{
    public function run(): void
    {
        $name = trim((string) config('super_admin.name'));
        $username = trim((string) config('super_admin.username'));
        $email = trim((string) config('super_admin.email'));

        if ($name === '' || $username === '' || $email === '') {
            throw new RuntimeException(
                'SuperAdminSeeder: set SUPER_ADMIN_NAME, SUPER_ADMIN_USERNAME and SUPER_ADMIN_EMAIL first. Nothing was created.'
            );
        }

        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new RuntimeException(
                'SuperAdminSeeder: SUPER_ADMIN_EMAIL is not a valid email address. Nothing was created.'
            );
        }

        $user = DB::transaction(function () use ($name, $username, $email) {
            $belongsToAnotherRole = User::query()
                ->where(fn ($q) => $q->where('email', $email)->orWhere('username', $username))
                ->where('role', '!=', User::ROLE_SUPER_ADMIN)
                ->exists();

            if ($belongsToAnotherRole) {
                throw new RuntimeException(
                    'SuperAdminSeeder: that email or username already belongs to an account that is not a Super Administrator. Existing accounts are never promoted. Nothing was changed.'
                );
            }

            $user = User::firstOrNew(['email' => $email, 'role' => User::ROLE_SUPER_ADMIN]);
            $user->fill(['name' => $name, 'username' => $username]);

            if (! $user->exists) {
                $user->is_active = true;
            }

            // Not fillable (see User), so it is set directly. Re-asserted on
            // every run: this account must never be left without MFA.
            $user->forceFill(['mfa_method' => User::MFA_METHOD_EMAIL_OTP])->save();

            // A real event, unlike the demo audit rows DatabaseSeeder
            // deliberately refuses to invent. No signed-in user performed it,
            // so user_id is null, which the Audit Logs page shows as "system".
            Audit::record([
                'user_id' => null,
                'action' => $user->wasRecentlyCreated ? 'CREATE' : 'UPDATE',
                'module' => 'users',
                'target_type' => 'user',
                'description' => ($user->wasRecentlyCreated ? 'Provisioned' : 'Updated')
                    ." Super Administrator account {$user->username} from the command line (SuperAdminSeeder; MFA method: Email OTP)",
                'ip_address' => null,
            ]);

            return $user;
        });

        $this->command?->info(
            "Super Administrator {$user->username} <{$user->email}> is ready. "
            .'Create a Supabase Auth user with this exact email before signing in.'
        );
    }
}
