# CDARS backend — Laravel API served via php-fpm + nginx.
FROM php:8.2-fpm-alpine AS base
WORKDIR /var/www/html

RUN apk add --no-cache postgresql-dev libpng-dev libzip-dev oniguruma-dev \
    && docker-php-ext-install pdo pdo_pgsql pgsql mbstring zip gd

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY composer.json composer.lock* ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist

COPY . .
RUN composer dump-autoload --optimize \
    && php artisan config:cache \
    && php artisan route:cache

EXPOSE 9000
CMD ["php-fpm"]
