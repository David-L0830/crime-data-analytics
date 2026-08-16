<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->registerSqliteToCharForTests();
    }

    // Test-only SQLite compatibility shim. Production (AnalyticsController)
    // intentionally uses PostgreSQL's to_char(date, 'YYYY-MM') for the
    // monthly analytics grouping; SQLite (the test DB, per phpunit.xml)
    // has no such function. Rather than change the production SQL to
    // accommodate the test database, register a same-named SQLite user
    // function that supports the subset of Postgres to_char format tokens
    // this codebase actually uses (YYYY, MM, DD). This never runs outside
    // the sqlite test connection, so it has no production effect.
    private function registerSqliteToCharForTests(): void
    {
        if (config('database.default') !== 'sqlite') {
            return;
        }

        $pdo = DB::connection()->getPdo();

        $pdo->sqliteCreateFunction('to_char', function ($value, $format) {
            if ($value === null || $format === null) {
                return null;
            }

            try {
                $date = new \DateTime($value);
            } catch (\Exception) {
                return null;
            }

            $phpFormat = strtr($format, [
                'YYYY' => 'Y',
                'MM' => 'm',
                'DD' => 'd',
            ]);

            return $date->format($phpFormat);
        }, 2);
    }
}
