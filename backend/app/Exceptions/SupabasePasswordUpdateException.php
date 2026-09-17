<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * A Supabase Auth password update that did not succeed, classified by what is
 * KNOWN about its effect (see SupabaseAdminService::setPassword).
 *
 * The distinction callers act on is "definitely not applied" versus "outcome
 * unknown". A timeout, a dropped connection or a 5xx can all arrive after
 * Supabase has already stored the new password, so none of them is evidence
 * that the password was not changed. Only a definite refusal is.
 *
 * The message is always one of SupabaseAdminService's fixed sentences: it
 * never contains the password, the Supabase response body, or a previous
 * exception.
 */
final class SupabasePasswordUpdateException extends RuntimeException
{
    /** Supabase refused the password on policy grounds. Nothing was applied. */
    public const WEAK_PASSWORD = 'weak_password';

    /** No request was sent, or Supabase definitely refused it. Nothing was applied. */
    public const NOT_APPLIED = 'not_applied';

    /** Supabase may or may not have applied the password. */
    public const OUTCOME_UNKNOWN = 'outcome_unknown';

    public function __construct(string $message, public readonly string $outcome)
    {
        parent::__construct($message);
    }

    public function isWeakPassword(): bool
    {
        return $this->outcome === self::WEAK_PASSWORD;
    }

    public function wasDefinitelyNotApplied(): bool
    {
        return $this->outcome === self::WEAK_PASSWORD || $this->outcome === self::NOT_APPLIED;
    }
}
