<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Carbon;

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

    /**
     * When this account last signed in, or null if it never has.
     *
     * Derived from the existing audit trail — the LOGIN rows written by
     * AuthController::recordLoginIfFreshSignIn() — rather than from a
     * users.last_login column, deliberately. Sign-in happens entirely in
     * Supabase on the frontend, so Laravel observes it in exactly one place
     * and already records it there; adding a second, parallel timestamp
     * column would mean a new write path that could disagree with the audit
     * trail, for information the audit trail already holds accurately.
     *
     * Reads a `last_login_at` aggregate off the model when the caller has
     * already loaded one (UserController::index/show use withMax so listing
     * every account stays a single extra query, not one per row), and falls
     * back to querying for it when the model was built without it — e.g. the
     * single-record UserResource returned by update()/updateStatus(), where
     * one small aggregate is cheaper than making every call site remember to
     * eager-load it.
     */
    public function lastLoginAt(): ?Carbon
    {
        $value = array_key_exists('last_login_at', $this->getAttributes())
            ? $this->getAttributes()['last_login_at']
            : $this->auditLogs()->where('action', 'LOGIN')->max('created_at');

        return $value ? Carbon::parse($value) : null;
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
