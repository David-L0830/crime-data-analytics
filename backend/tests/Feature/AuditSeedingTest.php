<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\AuditLog;
use App\Models\Incident;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Seeding the database must not fabricate audit history.
 *
 * AuditLogSeeder wrote 40 rows drawn at random from five hard-coded templates
 * — "User signed in", "User signed out", "Report exported as CSV", "Resident
 * record updated", "Incident record updated" — every one of them attributed to
 * the admin account, at IP 127.0.0.1, back-dated three hours apart. None of
 * them recorded anything that happened. An audit trail whose contents are
 * invented is worse than an empty one: it is the record a barangay would rely
 * on to answer who did what, and it cannot be told apart from the real rows
 * beside it.
 *
 * Two of the five were also self-contradicting by the time they were removed.
 * "Resident record updated" named a module that no longer exists — the
 * residents table was dropped and there is no ResidentController. "Report
 * exported as CSV" named a format the system does not produce: exports are
 * .xlsx through exportWorkbook, and a real REPORT_EXPORTED row now reads
 * "Exported the <Report> report".
 *
 * The seeder is deleted rather than rewritten to derive from real rows. Unlike
 * a notification, an audit entry has no truthful demo form: it asserts that a
 * specific person did a specific thing at a specific time, and seeding cannot
 * make that true. Audit history is earned by using the system.
 *
 * Historical rows are untouched by this. Nothing here deletes or rewrites
 * existing audit records, including any resident rows already in a database.
 */
class AuditSeedingTest extends TestCase
{
    use RefreshDatabase;

    public function test_seeding_the_database_writes_no_audit_rows(): void
    {
        $this->seed(DatabaseSeeder::class);

        $this->assertSame(0, AuditLog::count());
    }

    // There is deliberately no `class_exists(AuditLogSeeder::class)` assertion
    // here. backend/vendor is committed, and its generated
    // vendor/composer/autoload_classmap.php still maps that class to the file
    // this change deletes, so class_exists() triggers an include of a missing
    // path and raises an ErrorException instead of returning false. The
    // assertion would be reporting the state of a stale build artifact rather
    // than the state of the codebase. Regenerating the classmap needs
    // `composer dump-autoload`, which rewrites tracked files under vendor/.
    //
    // Nothing is lost by leaving it out: the test above pins the behaviour that
    // actually matters — seeding the database produces no audit rows — and it
    // would fail just as loudly if a seeder that manufactures audit history
    // were reintroduced under any name.

    public function test_the_other_seeders_still_populate_their_own_tables(): void
    {
        // Removing one entry from DatabaseSeeder must not disturb the rest of
        // the seeding chain.
        $this->seed(DatabaseSeeder::class);

        $this->assertDatabaseCount('users', 3);
        $this->assertGreaterThan(0, Incident::count());
        $this->assertGreaterThan(0, AppNotification::count());
    }
}
