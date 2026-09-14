<?php

namespace Tests\Feature;

use App\Models\EmailMfaChallenge;
use App\Models\EmailMfaFailureWindow;
use App\Models\EmailMfaVerifiedSession;
use App\Models\User;
use App\Services\EmailMfaService;
use Illuminate\Support\Facades\DB;
use ReflectionMethod;
use Tests\TestCase;

/**
 * G5 — one-time consumption of an email MFA code under CONCURRENT access.
 *
 * WHAT THIS PROVES THAT EmailMfaTest CANNOT
 *
 * EmailMfaTest already proves sequential replay protection: submit a code,
 * submit it again, the second is refused. That runs on in-memory SQLite, which
 * has no meaningful row-level locking and never overlaps two transactions, so
 * it says nothing about two requests arriving at the same instant. A code is a
 * bearer secret worth exactly one session, and "two verifications raced and
 * both won" is a real-world outcome that sequential tests cannot see.
 *
 * EmailMfaService::verifyCode() defends against this with DB::transaction()
 * plus lockForUpdate() — PostgreSQL SELECT ... FOR UPDATE. This test exercises
 * that for real: two independent OS processes, two independent PostgreSQL
 * connections, both calling the production verifyCode() with the same valid
 * code, deliberately forced to overlap inside the critical section.
 *
 * HOW THE OVERLAP IS FORCED, WITHOUT TOUCHING PRODUCTION CODE
 *
 * The test holds a row lock on the challenge from a third connection before
 * the workers start. Both workers then block — the real implementation blocks
 * at its SELECT ... FOR UPDATE, and an implementation without that lock would
 * still block at its UPDATE — and the test waits until PostgreSQL confirms two
 * backends are actually waiting on a lock. Only then does it release. Both
 * workers are therefore provably in flight at the same moment, which is what
 * makes the result deterministic instead of a timing coin-flip.
 *
 * WHY THERE IS NO RefreshDatabase
 *
 * These assertions only mean something against real PostgreSQL, and the only
 * PostgreSQL available is the developer's local Supabase stack.
 * RefreshDatabase would migrate and wipe it. Instead this creates one clearly
 * named temporary user and one challenge, and removes both — plus the sequence
 * value it consumed — in a finally block.
 */
class EmailMfaConcurrencyTest extends TestCase
{
    private const SESSION_ID = '55555555-5555-4555-8555-555555555555';

    private const CODE = '424242';

    /**
     * users.supabase_user_id is a real uuid column in PostgreSQL, so this
     * fixture cannot use the readable placeholder strings the SQLite-backed
     * EmailMfaTest gets away with.
     */
    private const SUPABASE_USER_ID = '99999999-9999-4999-8999-999999999999';

    /** Advisory-free barrier: the challenge row itself is the rendezvous. */
    private ?User $tempUser = null;

    private ?int $userSeqBefore = null;

    private ?bool $userSeqCalledBefore = null;

    /** @var array<int, string> temp worker scripts to remove */
    private array $workerScripts = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('Concurrency is only observable on PostgreSQL; the default test connection is SQLite.');
        }
    }

    protected function tearDown(): void
    {
        // Roll back a barrier transaction the test may have left open before
        // anything tries to delete the rows it locks.
        while (DB::transactionLevel() > 0) {
            DB::rollBack();
        }

        foreach ($this->workerScripts as $script) {
            @unlink($script);
        }
        $this->workerScripts = [];

        if ($this->tempUser) {
            EmailMfaVerifiedSession::where('user_id', $this->tempUser->id)->delete();
            EmailMfaChallenge::where('user_id', $this->tempUser->id)->delete();
            EmailMfaFailureWindow::where('user_id', $this->tempUser->id)->delete();
            User::whereKey($this->tempUser->id)->delete();
            $this->tempUser = null;
        }

        // Restore the sequence the temporary user consumed, so the database is
        // left exactly as it was found.
        if ($this->userSeqBefore !== null) {
            DB::select(
                'select setval(?, ?, '.($this->userSeqCalledBefore ? 'true' : 'false').')',
                ['users_id_seq', $this->userSeqBefore]
            );
            $this->userSeqBefore = null;
        }

        parent::tearDown();
    }

    /**
     * A temporary account plus one valid, unconsumed challenge for it.
     *
     * The code hash is produced by the service's own hashCode(), reached by
     * reflection rather than reimplemented here — a second copy of the HMAC
     * recipe in a test would silently stop matching the day production changed.
     */
    private function seedChallenge(): void
    {
        $seq = DB::selectOne('select last_value, is_called from users_id_seq');
        $this->userSeqBefore = (int) $seq->last_value;
        $this->userSeqCalledBefore = (bool) $seq->is_called;

        $this->tempUser = User::factory()->create([
            'username' => 'g5-concurrency-temp',
            'name' => 'G5 Concurrency Temp',
            'email' => 'g5-concurrency-temp@example.test',
            'role' => User::ROLE_ENCODER,
            'supabase_user_id' => self::SUPABASE_USER_ID,
            'mfa_method' => User::MFA_METHOD_EMAIL_OTP,
        ]);

        // PHP 8.1+ invokes non-public methods reflectively without
        // setAccessible(), which is deprecated.
        $this->seedChallengeFor(self::SESSION_ID);
    }

    /** An additional valid, unconsumed challenge for the same temp user. */
    private function seedChallengeFor(string $sessionId): void
    {
        // PHP 8.1+ invokes non-public methods reflectively without
        // setAccessible(), which is deprecated.
        $hashCode = new ReflectionMethod(EmailMfaService::class, 'hashCode');

        EmailMfaChallenge::create([
            'user_id' => $this->tempUser->id,
            'supabase_session_id' => $sessionId,
            'code_hash' => $hashCode->invoke(app(EmailMfaService::class), $this->tempUser, $sessionId, self::CODE),
            'attempts' => 0,
            'expires_at' => now()->addMinutes(5),
            'consumed_at' => null,
        ]);
    }

    /**
     * Launches a worker process that calls the real verifyCode() against the
     * same local database. Returns the process handle and its stdout pipe.
     *
     * @return array{0: resource, 1: array<int, resource>}
     */
    private function startWorker(string $sessionId, string $code): array
    {
        $root = str_replace('\\', '/', base_path());

        $worker = <<<'PHP'
$root = getenv('G5_ROOT');
require $root.'/vendor/autoload.php';
$app = require $root.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$user = App\Models\User::find((int) getenv('G5_USER_ID'));
$ok = app(App\Services\EmailMfaService::class)->verifyCode(
    $user,
    (string) getenv('G5_SESSION'),
    (string) getenv('G5_CODE')
);
echo json_encode(['ok' => $ok]);
PHP;

        // The suite's own env pins DB_CONNECTION=sqlite / DB_DATABASE=:memory:
        // (phpunit.xml). The worker must reach the same PostgreSQL database
        // this test is inspecting, so those two are overridden; everything
        // else — including APP_KEY, which the code hash depends on — is
        // inherited so parent and worker agree.
        $env = getenv();
        $env['DB_CONNECTION'] = 'pgsql';
        $env['DB_DATABASE'] = 'postgres';
        $env['G5_ROOT'] = $root;
        $env['G5_USER_ID'] = (string) $this->tempUser->id;
        $env['G5_SESSION'] = $sessionId;
        $env['G5_CODE'] = $code;

        // Written to a temp file rather than passed with `php -r`: the inline
        // form has to survive cmd.exe quoting on Windows, which it does not do
        // reliably. Removed again in tearDown().
        $script = tempnam(sys_get_temp_dir(), 'g5_worker_').'.php';
        file_put_contents($script, "<?php\n".$worker);
        $this->workerScripts[] = $script;

        $command = '"'.PHP_BINARY.'" "'.$script.'"';

        $pipes = [];
        $process = proc_open(
            $command,
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
            base_path(),
            $env
        );

        $this->assertIsResource($process, 'Could not start a concurrency worker process.');

        return [$process, $pipes];
    }

    /** Backends other than this one that PostgreSQL reports as waiting on a lock. */
    private function blockedBackends(): int
    {
        // PostgreSQL 15+ defaults stats_fetch_consistency to 'cache', which
        // freezes pg_stat_activity for the remainder of the reading
        // transaction. This poll runs inside the barrier transaction, so
        // without discarding that snapshot every iteration would keep
        // returning the very first (pre-worker) reading forever.
        DB::select('select pg_stat_clear_snapshot()');

        return (int) DB::selectOne(
            "select count(*) as c
               from pg_stat_activity
              where datname = current_database()
                and pid <> pg_backend_pid()
                and wait_event_type = 'Lock'"
        )->c;
    }

    public function test_two_concurrent_verifications_of_the_same_code_cannot_both_succeed(): void
    {
        $this->seedChallenge();

        // Hold the challenge row from this connection. Both workers will pile
        // up behind it, which is what guarantees they overlap.
        DB::beginTransaction();
        $locked = DB::select(
            'select id from email_mfa_challenges where user_id = ? and supabase_session_id = ? for update',
            [$this->tempUser->id, self::SESSION_ID]
        );
        $this->assertCount(1, $locked, 'The barrier SELECT ... FOR UPDATE matched no challenge row, so no lock was taken.');
        $this->assertSame(1, DB::transactionLevel(), 'The barrier transaction is not open.');

        [$processA, $pipesA] = $this->startWorker(self::SESSION_ID, self::CODE);
        [$processB, $pipesB] = $this->startWorker(self::SESSION_ID, self::CODE);

        // Wait until PostgreSQL itself confirms both workers are blocked on a
        // lock. This is the assertion that the overlap is real rather than
        // hoped for.
        $deadline = microtime(true) + 30;
        $blocked = 0;
        while (microtime(true) < $deadline) {
            $blocked = $this->blockedBackends();
            if ($blocked >= 2) {
                break;
            }
            usleep(100_000);
        }

        if ($blocked < 2) {
            // Release first, then surface whatever the workers said — an early
            // crash here is otherwise invisible behind the barrier assertion.
            DB::rollBack();
            $diagnostics = '';
            foreach ([[$processA, $pipesA], [$processB, $pipesB]] as $i => [$process, $pipes]) {
                $diagnostics .= "\nworker {$i} stdout: ".trim((string) stream_get_contents($pipes[1]));
                $diagnostics .= "\nworker {$i} stderr: ".trim((string) stream_get_contents($pipes[2]));
                fclose($pipes[1]);
                fclose($pipes[2]);
                proc_close($process);
            }

            $this->fail('Both workers should have been waiting on the challenge row lock; the overlap this test depends on did not happen.'.$diagnostics);
        }

        // Release. Both workers proceed into the critical section together.
        DB::rollBack();

        $results = [];
        foreach ([[$processA, $pipesA], [$processB, $pipesB]] as [$process, $pipes]) {
            $stdout = stream_get_contents($pipes[1]);
            $stderr = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            $exit = proc_close($process);

            $this->assertSame(0, $exit, "A concurrency worker failed (exit {$exit}): ".$stderr);

            $decoded = json_decode(trim($stdout), true);
            $this->assertIsArray($decoded, 'A concurrency worker produced no result: '.$stdout.$stderr);
            $results[] = (bool) $decoded['ok'];
        }

        // THE POINT OF THE TEST.
        $this->assertCount(2, $results);
        $this->assertSame(
            1,
            count(array_filter($results)),
            'Exactly one of two concurrent verifications of the same code must succeed. Both succeeding means the code bought two sessions.'
        );

        // The loser got the ordinary generic refusal, not an error.
        $this->assertContains(false, $results);

        // Final state: consumed exactly once, one verified session, one attempt
        // recorded (the loser re-read the consumed row and never counted).
        $challenge = EmailMfaChallenge::where('user_id', $this->tempUser->id)->firstOrFail();
        $this->assertNotNull($challenge->consumed_at, 'The winning verification must consume the challenge.');
        $this->assertSame(1, $challenge->attempts);

        $this->assertSame(
            1,
            EmailMfaVerifiedSession::where('user_id', $this->tempUser->id)
                ->where('supabase_session_id', self::SESSION_ID)
                ->count(),
            'A raced verification must not leave two verified-session records.'
        );

        // And the code is spent: a later attempt with the same valid code fails.
        $this->assertFalse(
            app(EmailMfaService::class)->verifyCode($this->tempUser, self::SESSION_ID, self::CODE),
            'The consumed code must not be reusable after the race.'
        );
    }

    /**
     * M1 — the cumulative failure budget must not lose increments to a race.
     *
     * Two wrong guesses arriving together must both be counted. Without the
     * row lock in lockFailureWindow() they would both read the same count and
     * both write count+1, so one guess would be free — and an attacker able to
     * fire guesses in pairs would get twice the budget the configuration says.
     *
     * The two workers use DIFFERENT sessions, so they contend on nothing but
     * the shared per-user failure row. That row is therefore the barrier here,
     * exactly as the challenge row is in the test above.
     */
    public function test_concurrent_failed_verifications_cannot_lose_a_cumulative_increment(): void
    {
        $this->seedChallenge();
        $secondSession = '66666666-6666-4666-8666-666666666666';
        $this->seedChallengeFor($secondSession);

        // The failure row must exist before it can be used as the barrier;
        // this is the same row lockFailureWindow() would have created.
        EmailMfaFailureWindow::create([
            'user_id' => $this->tempUser->id,
            'failures' => 0,
            'window_started_at' => now(),
        ]);

        DB::beginTransaction();
        $locked = DB::select(
            'select id from email_mfa_failure_windows where user_id = ? for update',
            [$this->tempUser->id]
        );
        $this->assertCount(1, $locked, 'The barrier SELECT ... FOR UPDATE matched no failure row.');

        // Both submit a WRONG code, on their own session and own challenge.
        [$processA, $pipesA] = $this->startWorker(self::SESSION_ID, '000000');
        [$processB, $pipesB] = $this->startWorker($secondSession, '000000');

        $deadline = microtime(true) + 30;
        $blocked = 0;
        while (microtime(true) < $deadline) {
            $blocked = $this->blockedBackends();
            if ($blocked >= 2) {
                break;
            }
            usleep(100_000);
        }

        if ($blocked < 2) {
            DB::rollBack();
            $diagnostics = '';
            foreach ([[$processA, $pipesA], [$processB, $pipesB]] as $i => [$process, $pipes]) {
                $diagnostics .= "\nworker {$i} stdout: ".trim((string) stream_get_contents($pipes[1]));
                $diagnostics .= "\nworker {$i} stderr: ".trim((string) stream_get_contents($pipes[2]));
                fclose($pipes[1]);
                fclose($pipes[2]);
                proc_close($process);
            }

            $this->fail('Both workers should have been waiting on the failure-window row lock.'.$diagnostics);
        }

        DB::rollBack();

        foreach ([[$processA, $pipesA], [$processB, $pipesB]] as [$process, $pipes]) {
            $stdout = stream_get_contents($pipes[1]);
            $stderr = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            $exit = proc_close($process);

            $this->assertSame(0, $exit, "A concurrency worker failed (exit {$exit}): ".$stderr);
            $decoded = json_decode(trim($stdout), true);
            $this->assertIsArray($decoded, 'A concurrency worker produced no result: '.$stdout.$stderr);
            $this->assertFalse((bool) $decoded['ok'], 'A wrong code must never verify.');
        }

        // THE POINT: two concurrent wrong guesses, two counted failures.
        $this->assertSame(
            2,
            (int) EmailMfaFailureWindow::where('user_id', $this->tempUser->id)->value('failures'),
            'Concurrent failed verifications must each count against the cumulative budget; a lost update would hand the attacker a free guess.'
        );
    }
}
