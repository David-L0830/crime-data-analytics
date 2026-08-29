<?php

namespace Tests\Feature;

use App\Models\Criminal;
use App\Models\Incident;
use App\Models\User;
use App\Models\Victim;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// Record codes (INC-00001 / CR-0001 / V-0001) used to be minted from
// max(id) + 1, read outside any transaction. That is a PREDICTION of the id the
// row is about to receive, made before the row exists, under no lock — and it
// is wrong in two ways.
//
// 1. Concurrency. Two simultaneous creates read the same max(id), compute the
//    same code, and the second insert violates the unique index on the code
//    column. One encoder gets a 500 and their record is not saved.
//
// 2. It does not recover. Once ANY row holds a code number that the id counter
//    has not yet reached, every subsequent create recomputes that same
//    colliding code — the failed insert rolls back, so max(id) never advances
//    and the endpoint is wedged on 500 permanently. Measured before the fix:
//    three identical requests returned 500, 500, 500 with the table unchanged.
//
// The code names one specific row, so it is now derived from that row's own id,
// inside the transaction, after the insert. Ids are unique, so two concurrent
// transactions can never want the same code and the race is gone by
// construction rather than by retrying.
//
// The one collision that remains possible is with a legacy row that already
// holds the code a later id derives — static data, not a race. It falls back to
// the suffix convention syncEvidence() has always used for evidence references
// (EV-001 -> EV-001-2), so a create always succeeds rather than 500-ing.
//
// Production was verified clean before this change: incidents 123/123, criminals
// 25/25, victims 12/12, zero divergence between code and id, and all three id
// sequences level with max(id). No existing code is rewritten and no backfill is
// performed — these tests pin behaviour for records created from now on.
class RecordCodeTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create([
            'username' => 'admin1',
            'email' => 'admin1@example.com',
            'role' => User::ROLE_BADAC_ADMIN,
        ]);
    }

    private function incidentPayload(array $overrides = []): array
    {
        return array_merge([
            'caseNumber' => 'CN-2025-'.fake()->unique()->numberBetween(1000, 9999),
            'crimeType' => 'Theft',
            'date' => '2025-06-01',
            'sitio' => 'Sitio 1',
        ], $overrides);
    }

    private function criminalPayload(array $overrides = []): array
    {
        return array_merge([
            'fullName' => 'Test Person '.fake()->unique()->numberBetween(1000, 9999),
        ], $overrides);
    }

    private function victimPayload(array $overrides = []): array
    {
        return array_merge([
            'fullName' => 'Test Victim '.fake()->unique()->numberBetween(1000, 9999),
        ], $overrides);
    }

    // ===== 1. the format on a clean database is unchanged =====
    //
    // The whole point of deriving from the row's own id is that on a database
    // where codes and ids already agree — which production does — nothing about
    // the visible identifier changes at all.

    public function test_a_clean_database_still_produces_the_documented_incident_code(): void
    {
        $this->actingAsSupabase($this->admin());

        $this->postJson('/api/incidents', $this->incidentPayload())
            ->assertCreated()
            ->assertJsonPath('data.incidentId', 'INC-00001');

        $this->postJson('/api/incidents', $this->incidentPayload())
            ->assertCreated()
            ->assertJsonPath('data.incidentId', 'INC-00002');
    }

    public function test_a_clean_database_still_produces_the_documented_criminal_code(): void
    {
        $this->actingAsSupabase($this->admin());

        $this->postJson('/api/criminals', $this->criminalPayload())
            ->assertStatus(201)
            ->assertJsonPath('data.criminalId', 'CR-0001');

        $this->postJson('/api/criminals', $this->criminalPayload())
            ->assertStatus(201)
            ->assertJsonPath('data.criminalId', 'CR-0002');
    }

    public function test_a_clean_database_still_produces_the_documented_victim_code(): void
    {
        $this->actingAsSupabase($this->admin());

        $this->postJson('/api/victims', $this->victimPayload())
            ->assertStatus(201)
            ->assertJsonPath('data.victimId', 'V-0001');

        $this->postJson('/api/victims', $this->victimPayload())
            ->assertStatus(201)
            ->assertJsonPath('data.victimId', 'V-0002');
    }

    // ===== 2. a code sitting ahead of max(id) no longer 500s =====
    //
    // This is the exact state that wedged each endpoint. Every one of these
    // three returned HTTP 500 before the fix.

    public function test_an_incident_code_ahead_of_max_id_no_longer_breaks_creation(): void
    {
        $this->actingAsSupabase($this->admin());

        // Row id 1 already carrying the code that max(id) + 1 would compute.
        Incident::create([
            'incident_code' => 'INC-00002',
            'case_number' => 'CN-2025-0001',
            'crime_type' => 'Theft',
            'incident_date' => '2025-06-01',
            'sitio' => 'Sitio 1',
        ]);

        $this->postJson('/api/incidents', $this->incidentPayload())
            ->assertCreated();

        $this->assertSame(2, Incident::count());
        $this->assertSame(2, Incident::distinct()->count('incident_code'));
    }

    public function test_a_criminal_code_ahead_of_max_id_no_longer_breaks_creation(): void
    {
        $this->actingAsSupabase($this->admin());

        Criminal::create([
            'criminal_code' => 'CR-0002',
            'full_name' => 'Pre-existing Record',
            'status' => 'Active',
        ]);

        $this->postJson('/api/criminals', $this->criminalPayload())
            ->assertStatus(201);

        $this->assertSame(2, Criminal::count());
        $this->assertSame(2, Criminal::distinct()->count('criminal_code'));
    }

    public function test_a_victim_code_ahead_of_max_id_no_longer_breaks_creation(): void
    {
        $this->actingAsSupabase($this->admin());

        Victim::create([
            'victim_code' => 'V-0002',
            'full_name' => 'Pre-existing Victim',
        ]);

        $this->postJson('/api/victims', $this->victimPayload())
            ->assertStatus(201);

        $this->assertSame(2, Victim::count());
        $this->assertSame(2, Victim::distinct()->count('victim_code'));
    }

    // ===== 3. the former wedge state keeps accepting records =====

    public function test_repeated_creates_in_the_former_wedge_state_all_succeed(): void
    {
        $this->actingAsSupabase($this->admin());

        Criminal::create([
            'criminal_code' => 'CR-0002',
            'full_name' => 'Pre-existing Record',
            'status' => 'Active',
        ]);

        // Three identical requests. Before the fix these returned 500, 500, 500
        // and the table stayed at one row.
        for ($i = 0; $i < 3; $i++) {
            $this->postJson('/api/criminals', $this->criminalPayload())
                ->assertStatus(201);
        }

        $this->assertSame(4, Criminal::count());
        $this->assertSame(4, Criminal::distinct()->count('criminal_code'));
    }

    // ===== 4. the placeholder is never observable =====
    //
    // The insert needs SOME value because the code column is NOT NULL UNIQUE and
    // the id does not exist yet. It is replaced inside the same transaction, so
    // no reader can ever see it and a rollback takes it with them.

    public function test_no_temporary_placeholder_survives_a_create(): void
    {
        $this->actingAsSupabase($this->admin());

        Criminal::create([
            'criminal_code' => 'CR-0003',
            'full_name' => 'Pre-existing Record',
            'status' => 'Active',
        ]);

        $this->postJson('/api/incidents', $this->incidentPayload())->assertCreated();
        $this->postJson('/api/criminals', $this->criminalPayload())->assertStatus(201);
        $this->postJson('/api/victims', $this->victimPayload())->assertStatus(201);

        $this->assertSame(0, Incident::where('incident_code', 'like', 'TMP-%')->count());
        $this->assertSame(0, Criminal::where('criminal_code', 'like', 'TMP-%')->count());
        $this->assertSame(0, Victim::where('victim_code', 'like', 'TMP-%')->count());
    }

    // ===== 5. every code names its own row =====

    public function test_a_generated_code_always_corresponds_to_the_row_id(): void
    {
        $this->actingAsSupabase($this->admin());

        for ($i = 0; $i < 3; $i++) {
            $this->postJson('/api/incidents', $this->incidentPayload())->assertCreated();
            $this->postJson('/api/criminals', $this->criminalPayload())->assertStatus(201);
            $this->postJson('/api/victims', $this->victimPayload())->assertStatus(201);
        }

        foreach (Incident::all() as $row) {
            $this->assertSame('INC-'.str_pad((string) $row->id, 5, '0', STR_PAD_LEFT), $row->incident_code);
        }

        foreach (Criminal::all() as $row) {
            $this->assertSame('CR-'.str_pad((string) $row->id, 4, '0', STR_PAD_LEFT), $row->criminal_code);
        }

        foreach (Victim::all() as $row) {
            $this->assertSame('V-'.str_pad((string) $row->id, 4, '0', STR_PAD_LEFT), $row->victim_code);
        }
    }

    // ===== 6. the documented suffix fallback, not a next-free-number scheme =====
    //
    // A legacy row holding CR-0003 means the row that lands on id 3 cannot have
    // its own code. It takes CR-0003-2 — the same convention syncEvidence() uses
    // for a repeated evidence reference — rather than skipping to the next free
    // number, so the code still visibly names row 3.

    public function test_a_code_already_taken_by_a_legacy_row_falls_back_to_the_evidence_suffix_convention(): void
    {
        $this->actingAsSupabase($this->admin());

        Criminal::create([
            'criminal_code' => 'CR-0003',
            'full_name' => 'Legacy Record',
            'status' => 'Active',
        ]);

        // id 2 is free and behaves normally.
        $this->postJson('/api/criminals', $this->criminalPayload())
            ->assertStatus(201)
            ->assertJsonPath('data.criminalId', 'CR-0002');

        // id 3's own code is taken by the legacy row, so it is suffixed.
        $this->postJson('/api/criminals', $this->criminalPayload())
            ->assertStatus(201)
            ->assertJsonPath('data.criminalId', 'CR-0003-2');

        // id 4 is unaffected — the fallback does not shift the numbering.
        $this->postJson('/api/criminals', $this->criminalPayload())
            ->assertStatus(201)
            ->assertJsonPath('data.criminalId', 'CR-0004');
    }
}
