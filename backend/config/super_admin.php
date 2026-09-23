<?php

// Backs Database\Seeders\SuperAdminSeeder — the ONLY way a Super
// Administrator account is created. No API route or screen can create one
// (see User::ROLE_SUPER_ADMIN), so the account's identity comes from the
// environment of whoever runs the seeder, never from a request.
//
// All three are required; the seeder refuses to run with any of them blank
// rather than invent a person.

return [

    'name' => env('SUPER_ADMIN_NAME'),

    'username' => env('SUPER_ADMIN_USERNAME'),

    // Must be the exact address of the account's Supabase Auth user, which is
    // created separately (Supabase Dashboard -> Authentication -> Users):
    // SupabaseTokenValidator links a verified sign-in to this row by email.
    'email' => env('SUPER_ADMIN_EMAIL'),

];
