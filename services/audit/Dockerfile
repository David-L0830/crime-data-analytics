# service-audit — the isolated audit logging microservice.
#
# PHP plus pdo_pgsql, no framework and no Composer dependencies. Served by
# PHP's built-in web server with PHP_CLI_SERVER_WORKERS, which is adequate for
# this local stack (a handful of internal callers); a hosted deployment would
# put php-fpm behind a real web server instead.
FROM php:8.2-cli-alpine

RUN apk add --no-cache postgresql-dev \
    && docker-php-ext-install pdo_pgsql

WORKDIR /srv/audit
COPY src ./src
COPY public ./public
COPY tests ./tests

ENV PHP_CLI_SERVER_WORKERS=4
EXPOSE 8080

# Unprivileged at runtime.
USER www-data

HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
    CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1

CMD ["php", "-S", "0.0.0.0:8080", "public/index.php"]
