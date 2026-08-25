# CDARS backend — Laravel API served by nginx + php-fpm.
#
# Two deployment fixes relative to the original image, both confined to this
# file and its docker/ helpers — no application code is affected:
#
#   1. The original ran php-fpm alone on port 9000. php-fpm speaks FastCGI,
#      not HTTP, so no browser or platform health check could ever get a
#      response. Nginx is now installed in front of it and listens on $PORT.
#   2. The original ran `php artisan config:cache` at BUILD time, where no
#      environment exists — caching null for every value, which then overrode
#      the real runtime environment. Cache building moved to docker/entrypoint.sh
#      so it runs against the injected environment instead.
FROM php:8.2-fpm-alpine AS base
WORKDIR /var/www/html

# nginx serves HTTP; gettext supplies envsubst for templating $PORT.
RUN apk add --no-cache nginx gettext \
    postgresql-dev libpng-dev libzip-dev oniguruma-dev \
    && docker-php-ext-install pdo pdo_pgsql pgsql mbstring zip gd

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY composer.json composer.lock* ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist

COPY . .

# Autoloader is environment-independent, so it stays a build step. config:cache
# and route:cache deliberately do NOT — see the entrypoint.
RUN composer dump-autoload --optimize

# nginx vhost template + php-fpm pool override (php-fpm -> 127.0.0.1:9001).
COPY docker/nginx.conf.template /etc/nginx/http.d/default.conf.template
COPY docker/php-fpm-pool.conf /usr/local/etc/php-fpm.d/zz-cdars.conf
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN rm -f /etc/nginx/http.d/default.conf \
    && sed -i 's/\r$//' /usr/local/bin/entrypoint.sh \
    && chmod +x /usr/local/bin/entrypoint.sh

# Laravel must be able to write its own caches and logs at runtime.
RUN chown -R www-data:www-data storage bootstrap/cache \
    && chmod -R ug+rwX storage bootstrap/cache

# Informational only. Render overrides this via $PORT; docker-compose keeps 9000.
EXPOSE 9000

CMD ["/usr/local/bin/entrypoint.sh"]
