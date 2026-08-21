<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

class User extends Authenticatable
{
    use HasFactory, Notifiable;

    // Three account types: Administrator (full access), Encoder (restricted
    // to the Crime Data Collection Module — see routes/api.php for the role
    // middleware and IncidentController for per-record ownership checks on
    // Encoder updates), and BADAC (read-only — see the ROLE_BADAC_READONLY
    // comment below).
    public const ROLE_BADAC_ADMIN = 'badac_admin';

    public const ROLE_ENCODER = 'encoder';

    // Read-only BADAC viewer account (seeded username "Badac", display name
    // "Gilbert Franco" — see database/seeders/UserSeeder.php). Can view
    // every module badac_admin can except User Management/Settings, but has
    // no create/edit/delete access anywhere — enforced via routes/api.php's
    // `role:` middleware (never included in a mutation route's allowed-role
    // list) rather than by any change to the controllers themselves.
    public const ROLE_BADAC_READONLY = 'badac_readonly';

    public const ROLE_LABELS = [
        self::ROLE_BADAC_ADMIN => 'Administrator',
        self::ROLE_ENCODER => 'Encoder',
        self::ROLE_BADAC_READONLY => 'BADAC',
    ];

    // Final auth migration — 'password' deliberately removed from
    // $fillable. This application no longer authenticates against a local
    // password (Supabase Auth owns every credential now — see
    // AUTH_MIGRATION_STATUS.md); nothing should ever mass-assign it again.
    // The `password` column itself is left in the database as a nullable,
    // unused legacy column rather than dropped outright — see the
    // 2025_02_01_000001 migration's comment for why it's nullable now
    // instead of destructively removed.
    protected $fillable = [
        'name',
        'username',
        'email',
        'role',
        'is_active',
        'supabase_user_id',
    ];

    // 'password' stays hidden even though it's no longer set for new
    // accounts — any already-migrated row may still carry an old Laravel
    // password hash (never deleted outright, see the migration above), and
    // it must never be serialized regardless.
    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_active' => 'boolean',
        ];
    }

    public function auditLogs()
    {
        return $this->hasMany(AuditLog::class);
    }

    public function incidents()
    {
        return $this->hasMany(Incident::class, 'reported_by');
    }

    public function getRoleLabelAttribute(): string
    {
        return self::ROLE_LABELS[$this->role] ?? $this->role;
    }

    public function isAdmin(): bool
    {
        return $this->role === self::ROLE_BADAC_ADMIN;
    }

    public function isEncoder(): bool
    {
        return $this->role === self::ROLE_ENCODER;
    }

    public function isReadOnlyViewer(): bool
    {
        return $this->role === self::ROLE_BADAC_READONLY;
    }
}
