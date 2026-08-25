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
