#!/bin/sh
# Container start-up for the Laravel API.
#
# Why this exists: the image used to run `php artisan config:cache` during the
# BUILD. A build has no .env and no platform environment variables, so every
# value was cached as null — and a cached config file WINS over env() at
# runtime. That silently blanked the database, Supabase and Metabase settings
# no matter how correctly they were set on the host. Caching here instead means
# the cache is built from the real, injected environment.
set -e

# Render injects PORT; docker-compose does not, so keep the previous 9000.
: "${PORT:=9000}"
export PORT

echo "[entrypoint] rendering nginx config on port ${PORT}"
envsubst '${PORT}' \
    < /etc/nginx/http.d/default.conf.template \
    > /etc/nginx/http.d/default.conf

# Rebuild caches from the live environment, but ONLY in production.
#
# The guard is not an optimisation, it is a safety rule. docker-compose bind
# mounts ./backend over /var/www/html for local development, so anything
# written to bootstrap/cache here lands in the developer's working tree — and
# config.php holds every resolved secret (DB_PASSWORD, the Supabase keys, the
# Metabase embedding key) in plaintext. bootstrap/cache is not gitignored, so
# that file would sit in `git status` waiting to be committed by accident.
# Render sets APP_ENV=production and has no bind mount, so it caches there and
# local development keeps its previous cache-free behaviour.
if [ "${APP_ENV}" = "production" ]; then
    echo "[entrypoint] building config cache from runtime environment"
    php artisan config:clear
    php artisan config:cache
    php artisan route:cache || echo "[entrypoint] route:cache skipped (non-fatal)"

    # Read-only migration-status check. This DOES NOT apply migrations, and
    # nothing in this container ever runs `migrate` — see the "Production
    # database migrations" section of backend/README.md.
    #
    # Why it exists: Render does not run Laravel migrations. There is no
    # pre-deploy command (that requires a paid instance type) and no
    # render.yaml, so a deploy can go live with the CODE ahead of the SCHEMA
    # and report success while doing it. That happened once: the criminal and
    # victim archive endpoints returned HTTP 500 until the migration was
    # applied by hand. This check makes that state loud in the deploy log
    # instead of silent.
    #
    # `--pending=1` is load-bearing. Plain `migrate:status` returns exit 0
    # EVEN WHEN MIGRATIONS ARE PENDING — StatusCommand::handle() only returns
    # a non-zero code when the --pending option itself is truthy — so keying
    # off the exit code of the bare command would report success in exactly
    # the case this check exists to catch. With `--pending=1`:
    #   exit 0        -> nothing pending
    #   exit non-zero -> pending, OR no migrations table, OR the command
    #                    could not run at all; the captured output tells
    #                    those apart below.
    #
    # Every branch is non-fatal by construction: the command runs as an `if`
    # condition, where `set -e` is suspended, and no branch exits. php-fpm and
    # nginx start regardless of the outcome.
    echo "[entrypoint] checking migration status (read-only, never applies migrations)"
    if php artisan migrate:status --pending=1 --no-ansi > /tmp/migrate-status.out 2>&1; then
        echo "[entrypoint] migration status: all migrations applied"
    elif grep -qE 'Pending|Migration table not found' /tmp/migrate-status.out; then
        echo "[entrypoint] =========================================================="
        echo "[entrypoint] WARNING: PRODUCTION HAS PENDING DATABASE MIGRATIONS"
        echo "[entrypoint] The deployed code may expect columns or tables that do"
        echo "[entrypoint] not exist yet. Migrations are NOT applied automatically."
        echo "[entrypoint] An authorized operator must review them and then run"
        echo "[entrypoint]     php artisan migrate --force"
        echo "[entrypoint] against production. See backend/README.md section 11,"
        echo "[entrypoint] \"Production database migrations\"."
        cat /tmp/migrate-status.out
        echo "[entrypoint] =========================================================="
    else
        # Deliberately does NOT echo the captured output: a connection failure
        # names the database host, port and database name, which do not belong
        # in a deploy log. The operator can re-run the command themselves.
        echo "[entrypoint] WARNING: could not verify migration status (database"
        echo "[entrypoint] unreachable or misconfigured). This is NOT a statement"
        echo "[entrypoint] that migrations are applied. Startup continues; check"
        echo "[entrypoint] manually with: php artisan migrate:status"
    fi
    rm -f /tmp/migrate-status.out
else
    echo "[entrypoint] APP_ENV=${APP_ENV:-unset} — skipping config cache (local bind-mount safety)"
fi

# Avatar uploads use the 'public' disk (ProfileController::avatar). The symlink
# lives in the image layer, so recreate it on every boot. Non-fatal: a missing
# symlink degrades avatars only, it must never stop the API from starting.
php artisan storage:link 2>/dev/null || true

echo "[entrypoint] starting php-fpm on 127.0.0.1:9001"
php-fpm -D

echo "[entrypoint] starting nginx in foreground"
exec nginx -g 'daemon off;'
