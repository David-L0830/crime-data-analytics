-- service-audit: the append-only audit store.
--
-- Runs once, when the audit-db container initialises an empty data volume
-- (/docker-entrypoint-initdb.d), as the database owner.
--
-- APPEND-ONLY IS ENFORCED HERE, NOT IN THE APPLICATION. Two independent
-- layers, so neither a bug in service-audit nor a stolen application
-- credential can rewrite history:
--
--   1. Triggers reject every UPDATE, DELETE and TRUNCATE on audit_events,
--      whoever issues it — including the table owner.
--   2. The application connects as audit_writer (02-app-role.sh), which is
--      granted INSERT and SELECT only. It does not own the table, so it cannot
--      drop it or disable the triggers either.
--
-- Only a database superuser could get around both (by disabling the triggers
-- as the owner), and service-audit never connects as one.

CREATE TABLE audit_events (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Chosen by the sender. UNIQUE is what makes delivery idempotent: the core
    -- app retries a failed delivery, and a retry of an event that did arrive
    -- is simply ignored (INSERT ... ON CONFLICT DO NOTHING — not an UPDATE, so
    -- the triggers below never see it).
    event_id      UUID        NOT NULL UNIQUE,

    occurred_at   TIMESTAMPTZ NOT NULL,             -- when the action happened (sender's clock)
    received_at   TIMESTAMPTZ NOT NULL DEFAULT now(), -- when this service stored it
    source        TEXT        NOT NULL DEFAULT 'app-core',

    -- A snapshot of who acted, taken when they acted. This service has no
    -- users table: a later rename or role change must not rewrite history.
    actor_user_id BIGINT,
    actor_name    TEXT,
    actor_role    TEXT,

    action        TEXT        NOT NULL,
    module        TEXT,
    target_type   TEXT,
    description   TEXT,
    ip_address    TEXT
);

CREATE INDEX audit_events_occurred_at_idx ON audit_events (occurred_at DESC, id DESC);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id, action, occurred_at DESC);

CREATE FUNCTION audit_events_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only: % is not permitted', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER audit_events_no_update_or_delete
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_reject_mutation();

-- Row triggers do not fire for TRUNCATE, which would otherwise empty the table
-- in one statement.
CREATE TRIGGER audit_events_no_truncate
    BEFORE TRUNCATE ON audit_events
    FOR EACH STATEMENT EXECUTE FUNCTION audit_events_reject_mutation();
