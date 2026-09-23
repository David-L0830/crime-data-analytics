# service-audit — the isolated audit logging microservice

An append-only store for CDARS audit events, with its own code, its own
database and its own HTTP interface. It shares no code and no database with the
core Laravel app (`backend/`). It runs **only in the local Docker Compose
stack**; hosted environments keep writing the audit trail to `audit_logs`
(see `backend/config/audit.php`).

## How it fits

```
core app (backend)                         service-audit              audit-db
  Audit::record([...])                                                 (Postgres)
    └─ after commit: ShipAuditEvent ─▶ Redis ─▶ worker ─▶ POST /v1/events ─▶ INSERT
                      (encrypted job)          (signed,     (verifies        (triggers refuse
                                                retried)     signature)       UPDATE/DELETE/
  GET /api/audit-logs (role-checked) ───────────────────▶ GET /v1/events      TRUNCATE)
```

- **Writes are queued.** An audited action never waits on, or fails because
  of, this service. Delivery is retried for up to a day and is idempotent: each
  event carries its own `event_id`, and a repeat is ignored.
- **Reads are proxied.** The Audit Logs page and per-account activity still
  call the core app, which enforces roles and forwards a signed request here.
- **No update or delete path exists** in the API, and the database refuses them
  regardless (below).

## HTTP interface

| Method | Path | Signed | Purpose |
|---|---|---|---|
| GET | `/health` | no | Liveness and database reachability |
| POST | `/v1/events` | yes | Append one event. `201` created, `200` duplicate (already stored), `422` invalid |
| GET | `/v1/events?limit=&actor_user_id=` | yes | Newest first; `limit` 1–500, default 200. Never returns `ip_address` |
| GET | `/v1/last-logins?user_ids=1,2,3` | yes | Latest `LOGIN` per user |

Any other method on these paths returns `405`.

**Signature.** Headers `X-Audit-Timestamp` (Unix seconds) and
`X-Audit-Signature`:

```
canonical = "{timestamp}\n{METHOD}\n{path?query}\n{sha256(body) hex}"
signature = hex(HMAC-SHA256(canonical, AUDIT_SERVICE_SECRET))
```

Requests outside a ±300-second window are rejected, which bounds replay. Both
this service and the core app assert the same fixed test vector, so the two
independent implementations are proven to agree.

## Append-only, enforced by the database

`database/01-schema.sql` and `02-app-role.sh` run once, when `audit-db`
initialises an empty volume:

1. **Triggers** reject every `UPDATE`, `DELETE` and `TRUNCATE` on
   `audit_events`, even from the table owner.
2. **`audit_writer`**, the only account the service uses, holds `INSERT` and
   `SELECT` and nothing else. It does not own the table, so it cannot disable
   the triggers or drop the table.

Only a database superuser could get past both, and the service never connects
as one. `audit-db` sits on an internal network that only `service-audit` can
reach.

## Configuration

| Variable | Purpose |
|---|---|
| `AUDIT_DB_DSN` | e.g. `pgsql:host=audit-db;port=5432;dbname=audit` |
| `AUDIT_DB_USER` / `AUDIT_DB_PASSWORD` | `audit_writer` and its password |
| `AUDIT_SERVICE_SECRET` | Shared HMAC key; must equal the core app's |

In Docker Compose these come from `AUDIT_SERVICE_SECRET`,
`AUDIT_DB_ADMIN_PASSWORD` and `AUDIT_DB_APP_PASSWORD` in the repository-root
`.env`.

## Tests

```bash
php tests/run.php
```

Signature and HTTP tests need nothing. The database tests run against a real
Postgres with the schema applied, and are skipped unless `AUDIT_TEST_DSN`,
`AUDIT_TEST_OWNER_USER/PASSWORD` and `AUDIT_TEST_APP_USER/PASSWORD` are set
(see the header of `tests/run.php`). Inside the Compose stack:

```bash
docker compose exec \
  -e AUDIT_TEST_DSN="pgsql:host=audit-db;port=5432;dbname=audit" \
  -e AUDIT_TEST_OWNER_USER=audit_admin -e AUDIT_TEST_OWNER_PASSWORD=... \
  -e AUDIT_TEST_APP_USER=audit_writer -e AUDIT_TEST_APP_PASSWORD=... \
  service-audit php tests/run.php
```

The database tests write real, permanent rows (the table is append-only), each
marked `source = 'test-suite'`.

## Limitations

- Served by PHP's built-in web server (`PHP_CLI_SERVER_WORKERS=4`), which suits
  this local stack. A hosted deployment would use php-fpm behind a web server.
- The existing audit history in the core app's `audit_logs` table is **not**
  migrated here; this trail starts empty.
