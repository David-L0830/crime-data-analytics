<?php

namespace App\Models;

use App\Services\Audit\AuditStore;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Carbon;

class User extends Authenticatable
{
    use HasFactory, Notifiable;

    // Four account types, split into two tiers of governance:
    //
    //   System Governance    — Super Administrator (see ROLE_SUPER_ADMIN).
    //   Operational Governance — Administrator (operational data, validation
    //     and the Encoder/Validator accounts), Encoder (restricted to the Crime
    //     Data Collection Module — see routes/api.php for the role middleware
    //     and IncidentController for per-record ownership checks on Encoder
    //     updates), and BADAC Validator (see the ROLE_BADAC_VALIDATOR comment
    //     below).
    //
    // The tiers differ by capability, never by data scope: this is a
    // single-tenant system for Barangay 178, and no role is filtered to a
    // subset of its records.
    public const ROLE_BADAC_ADMIN = 'badac_admin';

    public const ROLE_ENCODER = 'encoder';

    // BADAC Validator (seeded username "Badac", display name "Gilbert Franco"
    // — see database/seeders/UserSeeder.php). Replaces the former read-only
    // BADAC role. Views the Dashboard, Crime Mapping, Statistical Analysis,
    // Trends, Incident Records, Records and Reports, and may validate or
    // return incidents. It creates, edits, archives and restores nothing and
    // has no User Management, Settings, report-schedule or Audit Logs access —
    // enforced by routes/api.php's `role:` middleware, which lists this role
    // on no mutation route other than validate/return. Contact numbers and
    // addresses are withheld from it by the resources (canViewContactDetails).
    public const ROLE_BADAC_VALIDATOR = 'badac_validator';

    // Super Administrator — System Governance. Owns System Settings, the full
    // audit trail and the Administrator accounts. Read-only everywhere else:
    // it views the operational and analytics modules but creates, edits,
    // archives and validates nothing, because routes/api.php lists it on no
    // operational mutation route. Contact numbers and addresses are withheld
    // from it exactly as from the Validator (canViewContactDetails is an
    // allow-list and does not name it).
    //
    // No API path can create or manage one: it is in no role's
    // manageableRoles(), so StoreUserRequest refuses it and the
    // 'manage-account' Gate refuses every action on one. The only way an
    // account gets this role is database/seeders/SuperAdminSeeder.php.
    public const ROLE_SUPER_ADMIN = 'super_admin';

    public const ROLE_LABELS = [
        self::ROLE_BADAC_ADMIN => 'Administrator',
        self::ROLE_ENCODER => 'Encoder',
        self::ROLE_BADAC_VALIDATOR => 'BADAC Validator',
        self::ROLE_SUPER_ADMIN => 'Super Administrator',
    ];

    // Which accounts each role may create and manage through User Management:
    // each governance tier manages the tier below it. A role missing here
    // manages nothing. ROLE_SUPER_ADMIN appears in no list, deliberately —
    // see its comment above.
    private const MANAGEABLE_ROLES = [
        self::ROLE_SUPER_ADMIN => [self::ROLE_BADAC_ADMIN],
        self::ROLE_BADAC_ADMIN => [self::ROLE_ENCODER, self::ROLE_BADAC_VALIDATOR],
    ];

    // users.mfa_method — the one alternative to Supabase TOTP an account can
    // be explicitly configured for. Deliberately NOT in $fillable: it changes
    // how an owed second factor is satisfied, so no request payload may
    // mass-assign it.
    public const MFA_METHOD_EMAIL_OTP = 'email_otp';

    // The MFA methods an administrator may choose when creating an account
    // (StoreUserRequest). There is deliberately no "none".
    //
    // 'authenticator_app' is a REQUEST value only and is never written to
    // users.mfa_method: that column's CHECK constraint allows NULL or
    // 'email_otp', and NULL is what EnsureSupabaseAal2 treats as a Supabase
    // TOTP account. What makes such an account owe a factor is the
    // `app_metadata.mfa_required` flag on its Supabase identity, which
    // UserController::store() sets in the same call that creates it.
    public const MFA_METHOD_AUTHENTICATOR_APP = 'authenticator_app';

    public const MFA_METHOD_CHOICES = [
        self::MFA_METHOD_EMAIL_OTP,
        self::MFA_METHOD_AUTHENTICATOR_APP,
    ];

    // How long an administrator-issued temporary password stays acceptable.
    public const TEMPORARY_PASSWORD_TTL_HOURS = 72;

    // Minimum length for an administrator-supplied temporary password. Mirrors
    // MIN_PASSWORD_LENGTH in src/pages/ResetPassword.jsx, the project's existing
    // password minimum. Supabase Auth's own policy still applies on top of it.
    public const TEMPORARY_PASSWORD_MIN_LENGTH = 8;

    // bcrypt, which Supabase Auth uses, only reads the first 72 BYTES of a
    // password. Anything longer would be silently truncated, so it is refused.
    public const TEMPORARY_PASSWORD_MAX_BYTES = 72;

    // POST /me/password is refused unless the caller's session was established
    // (signed `amr` timestamp) at most this long ago.
    public const PASSWORD_CHANGE_RECENT_AUTH_SECONDS = 900;

    // Final auth migration — 'password' deliberately removed from
    // $fillable. This application no longer authenticates against a local
    // password (Supabase Auth owns every credential now — see
    // AUTH_MIGRATION_STATUS.md); nothing should ever mass-assign it again.
    // The `password` column itself is left in the database as a nullable,
    // unused legacy column rather than dropped outright — see the
    // 2025_02_01_000001 migration's comment for why it's nullable now
    // instead of destructively removed.
    //
    // The temporary-password state columns (must_change_password,
    // temporary_password_expires_at, password_changed_at,
    // temporary_password_issued_by) are deliberately NOT fillable either. They
    // decide whether an account must replace an administrator-known
    // credential, so only server code writes them, via forceFill().
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
            'must_change_password' => 'boolean',
            'temporary_password_expires_at' => 'datetime',
            'password_changed_at' => 'datetime',
        ];
    }

    public function auditLogs()
    {
        return $this->hasMany(AuditLog::class);
    }

    // The administrator who issued this account's current temporary password.
    public function temporaryPasswordIssuer()
    {
        return $this->belongsTo(User::class, 'temporary_password_issued_by');
    }

    /**
     * Owes a password change, but the temporary password has lapsed.
     *
     * Exactly at the expiry instant counts as expired (<=). A flagged account
     * with NO expiry recorded is also treated as expired: every issuing path
     * sets one, so its absence means the state cannot be trusted, and the safe
     * reading of an untrustworthy temporary credential is "no longer valid".
     * Nothing here ever moves the expiry.
     */
    public function temporaryPasswordExpired(): bool
    {
        if (! $this->must_change_password) {
            return false;
        }

        return $this->temporary_password_expires_at === null
            || $this->temporary_password_expires_at->lessThanOrEqualTo(now());
    }

    /**
     * Was the session making this request established before the account's
     * last password change? Such a session was opened with a credential that
     * no longer exists — possibly by someone who only knew the old temporary
     * password — so it must sign in again.
     *
     * Always false for an account whose password has never been changed here,
     * which is every existing account: they are unaffected. When the session
     * time is unknown (no usable `amr`) and a change HAS happened, the answer
     * is true — fail closed.
     */
    public function sessionPredatesPasswordChange(?int $sessionAuthenticatedAt): bool
    {
        if ($this->password_changed_at === null) {
            return false;
        }

        return $sessionAuthenticatedAt === null
            || $sessionAuthenticatedAt < $this->password_changed_at->getTimestamp();
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
        // With the trail in service-audit (AUDIT_DRIVER=service) there are no
        // LOGIN rows in this database; ask the audit store instead, failing
        // soft to "unknown" exactly like the other badges on this resource.
        if (! array_key_exists('last_login_at', $this->getAttributes()) && app(AuditStore::class)->isRemote()) {
            try {
                return app(AuditStore::class)->lastLogins([$this->id])[$this->id] ?? null;
            } catch (\Throwable) {
                return null;
            }
        }

        $value = array_key_exists('last_login_at', $this->getAttributes())
            ? $this->getAttributes()['last_login_at']
            : $this->auditLogs()->where('action', 'LOGIN')->max('created_at');

        return $value ? Carbon::parse($value) : null;
    }

    // Strict comparison on purpose: only the exact configured value opts an
    // account into email MFA. Nothing is inferred from having an email address.
    public function usesEmailOtpMfa(): bool
    {
        return $this->mfa_method === self::MFA_METHOD_EMAIL_OTP;
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

    public function isValidator(): bool
    {
        return $this->role === self::ROLE_BADAC_VALIDATOR;
    }

    public function isSuperAdmin(): bool
    {
        return $this->role === self::ROLE_SUPER_ADMIN;
    }

    /**
     * The roles this account may assign when creating an account, and may
     * act on through User Management. See MANAGEABLE_ROLES.
     *
     * @return array<int, string>
     */
    public function manageableRoles(): array
    {
        return self::MANAGEABLE_ROLES[$this->role] ?? [];
    }

    // Behind the 'manage-account' Gate (AppServiceProvider). Never true for
    // the caller's own account, whose role is never in its own list; that is
    // what /me is for.
    public function canManageAccount(User $target): bool
    {
        return in_array($target->role, $this->manageableRoles(), true);
    }

    // Record validation (validate / return for correction). The route
    // middleware admits the same two roles; this is the in-action repeat.
    public function canValidateRecords(): bool
    {
        return $this->isAdmin() || $this->isValidator();
    }

    /**
     * Whether this account may receive contact numbers and addresses —
     * complainant contact/address on incidents, and contact number/address on
     * criminal and victim records.
     *
     * An ALLOW-list, not a deny-list: only the two roles that enter and
     * maintain that data receive it. The BADAC Validator does not, and neither
     * does any role added later until it is deliberately listed here. The
     * resources enforce this on every response they build, so hiding the
     * fields in the UI is never what keeps them private.
     */
    public function canViewContactDetails(): bool
    {
        return $this->isAdmin() || $this->isEncoder();
    }

    /**
     * The browser-facing URL of this account's profile picture, or null when
     * none has been uploaded.
     *
     * WHY avatar_path CAN HOLD TWO DIFFERENT THINGS
     *
     * A Supabase Storage upload stores the full public URL; the local-disk
     * fallback stores a relative path like `avatars/7.png`, which is also what
     * every avatar uploaded before Supabase Storage existed looks like. Both
     * are still resolvable, so no data migration was needed and no existing
     * account lost its picture. The scheme test is what tells them apart.
     *
     * WHY THE LOCAL BRANCH DOES NOT SIMPLY USE Storage::disk('public')->url()
     *
     * That helper builds `config('app.url').'/storage/'.$path` (see
     * config/filesystems.php). APP_URL defaults to http://localhost:8000 and is
     * easy to leave that way on a deployed container — at which point every
     * avatar URL handed to the browser points at the VIEWER's own machine and
     * 404s, with the frontend's broken-image fallback quietly showing initials
     * instead. Falling back to the host the request actually arrived on fixes
     * that without hardcoding any domain: the value is read from the live
     * request, so it is correct on localhost, on Render, and on any future host
     * without a configuration change.
     *
     * APP_URL is still preferred when it is set to something usable, because a
     * proxy can make the request's own host wrong in ways a configured value is
     * not.
     */
    public function avatarUrl(): ?string
    {
        $path = $this->avatar_path;

        if (! $path) {
            return null;
        }

        // Supabase Storage (or any absolute URL) — already browser-facing.
        if (str_starts_with($path, 'http://') || str_starts_with($path, 'https://')) {
            return $path;
        }

        $base = rtrim((string) config('app.url'), '/');

        $looksLocal = $base === ''
            || str_contains($base, 'localhost')
            || str_contains($base, '127.0.0.1');

        if ($looksLocal && ! app()->runningInConsole() && app()->environment() !== 'local') {
            $requestRoot = rtrim((string) request()->getSchemeAndHttpHost(), '/');
            if ($requestRoot !== '') {
                $base = $requestRoot;
            }
        }

        return $base.'/storage/'.ltrim($path, '/');
    }
}
