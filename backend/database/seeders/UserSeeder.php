<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class UserSeeder extends Seeder
{
    // Administrator (full access) + a demo Encoder account (restricted
    // to the Crime Data Collection Module) — see App\Models\User for role
    // constants and routes/api.php for the enforcement.
    //
    // Final auth migration — this seeder no longer sets a Laravel password
    // (see AUTH_MIGRATION_STATUS.md; User::$fillable no longer includes
    // `password`, and users.password is now nullable — see the
    // 2025_02_01_000001 migration). These three accounts must additionally
    // be created in Supabase Auth (dashboard or Admin API) with these exact
    // email addresses — SupabaseTokenValidator links a verified Supabase
    // sign-in to the matching row here by email on first login and never
    // auto-creates one, so a row seeded here with no corresponding Supabase
    // Auth user cannot sign in at all until one is created there too.
    public function run(): void
    {
        User::updateOrCreate(
            ['username' => 'admin'],
            [
                'name' => 'John Paul Paran',
                'email' => 'paranjohnpaul15@gmail.com',
                'role' => User::ROLE_BADAC_ADMIN,
            ]
        );

        User::updateOrCreate(
            ['username' => 'encoder'],
            [
                'name' => 'Luiza Perez',
                'email' => 'luizaperez31@gmail.com',
                'role' => User::ROLE_ENCODER,
            ]
        );

        // Read-only BADAC viewer account — views Dashboard through Audit
        // Logs (see ROLE_BADAC_READONLY on the User model / ROLES.badac_readonly
        // in src/utils/constants.js) but can never create/edit/delete
        // anything; enforced server-side via routes/api.php's `role:`
        // middleware, not just hidden in the UI.
        User::updateOrCreate(
            ['username' => 'Badac'],
            [
                'name' => 'Gilbert Franco',
                'email' => 'gfranco11@gmail.com',
                'role' => User::ROLE_BADAC_READONLY,
            ]
        );
    }
}
