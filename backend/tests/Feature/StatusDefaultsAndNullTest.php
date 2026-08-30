<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\AuditLog;
use App\Models\Criminal;
use App\Models\Incident;
use App\Models\User;
use App\Models\Victim;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// Two pre-existing defects found while adding StatusValidationTest.
//
// Defect A — explicit `status: null` produced a 500. The rule carried
// 'nullable', so null passed validation, but incidents.status and
// criminals.status are NOT NULL DEFAULT ('Open' / 'Active') in both SQLite and
// production Postgres, so the null reached the driver and raised
// SQLSTATE[23000]. This was reachable from the real UI, not just the API:
// IncidentModal's status <select> offers an empty "Select…" option, and
// IncidentEditModal submits form.status raw, which Laravel's
// ConvertEmptyStringsToNull turns into null. Dropping 'nullable' turns that
// into an ordinary 422 while leaving an OMITTED status untouched — Laravel
// skips non-implicit rules for absent keys, so the key never reaches
// validated() and the column default still applies.
//
// Defect B — store() returned the un-refreshed model, so a column-defaulted
// status came back as null in the 201 payload even though the row held the
// default. DataContext.addRecord() pushes that response straight into React
// state, so a freshly created record showed a null status until reload.
//
// Victims are affected by B only: StoreVictimRequest has no status rule and
// VictimController::mapToColumns() maps no status column, so status can never
// reach that table through the API — every created victim relies on the
// default, which makes B universal there.
class StatusDefaultsAndNullTest extends TestCase
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

    // ===== Defect A — explicit null is a validation error, not a 500 =====

    public function test_explicit_null_status_on_incident_create_is_422_not_500(): void
    {
        $this->actingAsSupabase($this->admin());

        $response = $this->postJson('/api/incidents', $this->incidentPayload(['status' => null]));

        $response->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->assertNotSame(500, $response->getStatusCode());
        $this->assertSame(0, Incident::count());
    }

    public function test_explicit_null_status_on_incident_update_is_422_not_500(): void
    {
        $this->actingAsSupabase($this->admin());
        $incident = Incident::factory()->create(['status' => 'Open']);

        $response = $this->putJson("/api/incidents/{$incident->id}", ['status' => null]);

        $response->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->assertNotSame(500, $response->getStatusCode());
        // The stored row is untouched by the rejected request.
        $this->assertSame('Open', $incident->fresh()->status);
    }

    public function test_explicit_null_status_on_criminal_create_and_update_is_422_not_500(): void
    {
        $this->actingAsSupabase($this->admin());

        $create = $this->postJson('/api/criminals', ['fullName' => 'Null Status', 'status' => null]);
        $create->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->assertNotSame(500, $create->getStatusCode());
        $this->assertSame(0, Criminal::count());

        $criminal = Criminal::factory()->create(['status' => 'Wanted']);
        $update = $this->putJson("/api/criminals/{$criminal->id}", ['status' => null]);
        $update->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->assertNotSame(500, $update->getStatusCode());
        $this->assertSame('Wanted', $criminal->fresh()->status);
    }

    public function test_empty_string_status_is_also_rejected_cleanly(): void
    {
        // The exact shape the Edit Incident form submits when the status
        // <select> is left on its blank "Select…" option: '' becomes null via
        // ConvertEmptyStringsToNull before validation runs.
        $this->actingAsSupabase($this->admin());
        $incident = Incident::factory()->create(['status' => 'Open']);

        $this->putJson("/api/incidents/{$incident->id}", ['status' => ''])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);
    }

    // ===== Defect A — omission and valid values are unchanged =====

    public function test_omitted_status_still_succeeds_and_uses_the_database_default(): void
    {
        $this->actingAsSupabase($this->admin());

        $case = 'CN-2025-7777';
        $this->postJson('/api/incidents', $this->incidentPayload(['caseNumber' => $case]))
            ->assertCreated();
        $this->assertDatabaseHas('incidents', ['case_number' => $case, 'status' => 'Open']);

        $this->postJson('/api/criminals', ['fullName' => 'Omitted Status'])
            ->assertStatus(201);
        $this->assertDatabaseHas('criminals', ['full_name' => 'Omitted Status', 'status' => 'Active']);
    }

    public function test_all_valid_statuses_still_work_after_dropping_nullable(): void
    {
        $this->actingAsSupabase($this->admin());

        foreach (Incident::STATUSES as $status) {
            $this->postJson('/api/incidents', $this->incidentPayload(['status' => $status]))
                ->assertCreated()
                ->assertJsonPath('data.status', $status);
        }

        foreach (Criminal::STATUSES as $status) {
            $this->postJson('/api/criminals', ['fullName' => 'P '.$status, 'status' => $status])
                ->assertStatus(201)
                ->assertJsonPath('data.status', $status);
        }
    }

    // ===== Defect B — the 201 payload reflects the persisted row =====

    public function test_created_incident_returns_the_persisted_default_status(): void
    {
        $this->actingAsSupabase($this->admin());

        $case = 'CN-2025-8888';
        $response = $this->postJson('/api/incidents', $this->incidentPayload(['caseNumber' => $case]))
            ->assertCreated()
            ->assertJsonPath('data.status', 'Open');

        // Response and stored row agree.
        $stored = Incident::where('case_number', $case)->firstOrFail();
        $this->assertSame('Open', $stored->status);
        $this->assertSame($stored->status, $response->json('data.status'));
    }

    public function test_created_criminal_returns_the_persisted_default_status(): void
    {
        $this->actingAsSupabase($this->admin());

        $response = $this->postJson('/api/criminals', ['fullName' => 'Default Status Person'])
            ->assertStatus(201)
            ->assertJsonPath('data.status', 'Active');

        $stored = Criminal::where('full_name', 'Default Status Person')->firstOrFail();
        $this->assertSame('Active', $stored->status);
        $this->assertSame($stored->status, $response->json('data.status'));
    }

    public function test_created_victim_returns_the_persisted_default_status(): void
    {
        // Victims can never send a status, so every create relies on the
        // column default — B is universal here.
        $this->actingAsSupabase($this->admin());

        $response = $this->postJson('/api/victims', ['fullName' => 'Default Status Victim'])
            ->assertStatus(201)
            ->assertJsonPath('data.status', 'Active');

        $stored = Victim::where('full_name', 'Default Status Victim')->firstOrFail();
        $this->assertSame('Active', $stored->status);
        $this->assertSame($stored->status, $response->json('data.status'));
    }

    public function test_created_records_still_expose_their_generated_codes(): void
    {
        // fresh() must not drop anything the 201 payload already carried.
        $this->actingAsSupabase($this->admin());

        $this->postJson('/api/incidents', $this->incidentPayload())
            ->assertCreated()
            ->assertJsonPath('data.incidentId', 'INC-00001');

        $this->postJson('/api/criminals', ['fullName' => 'Code Check'])
            ->assertStatus(201)
            ->assertJsonPath('data.criminalId', 'CR-0001');
    }

    // ===== archive + audit behaviour unchanged =====

    public function test_archive_behaviour_and_audit_logging_are_unchanged(): void
    {
        $this->actingAsSupabase($this->admin());

        $incident = Incident::factory()->create(['status' => 'Open']);
        $this->putJson("/api/incidents/{$incident->id}/archive")
            ->assertOk()
            ->assertJsonPath('data.status', 'Archived');
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'ARCHIVE', 'module' => 'incidents', 'target_type' => 'incident',
        ]);

        $criminal = Criminal::factory()->create(['status' => 'Wanted']);
        $this->putJson("/api/criminals/{$criminal->id}/archive")
            ->assertOk()
            ->assertJsonPath('data.status', 'Archived');
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'ARCHIVE', 'module' => 'criminal-records',
        ]);

        // The row is never deleted.
        $this->assertDatabaseHas('incidents', ['id' => $incident->id, 'status' => 'Archived']);
        $this->assertDatabaseHas('criminals', ['id' => $criminal->id, 'status' => 'Archived']);
    }

    public function test_create_still_writes_its_create_audit_event(): void
    {
        $this->actingAsSupabase($this->admin());

        $this->postJson('/api/incidents', $this->incidentPayload(['caseNumber' => 'CN-2025-6001']))
            ->assertCreated();

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'CREATE',
            'module' => 'incidents',
            'description' => 'Created incident CN-2025-6001',
        ]);
    }

    // ===== Defect A, second instance — `priority` =====
    //
    // incidents.priority is NOT NULL DEFAULT 'Normal', exactly like
    // incidents.status, but its rule kept the 'nullable' that was removed from
    // status above. So explicit null still passed validation, still reached
    // IncidentController::mapToColumns() (which copies every key present in
    // the validated array), and still raised SQLSTATE[23000] as a 500. It was
    // the only NOT NULL DEFAULT column in the schema still validated as
    // nullable — criminals.status and victims.status were both already safe.

    public function test_explicit_null_priority_on_incident_create_is_422_not_500(): void
    {
        $this->actingAsSupabase($this->admin());

        $response = $this->postJson('/api/incidents', $this->incidentPayload(['priority' => null]));

        $response->assertUnprocessable()->assertJsonValidationErrors(['priority']);
        $this->assertNotSame(500, $response->getStatusCode());
        $this->assertSame(0, Incident::count());
    }

    public function test_explicit_null_priority_on_incident_update_is_422_not_500(): void
    {
        $this->actingAsSupabase($this->admin());
        $incident = Incident::factory()->create(['priority' => 'High']);

        $response = $this->putJson("/api/incidents/{$incident->id}", ['priority' => null]);

        $response->assertUnprocessable()->assertJsonValidationErrors(['priority']);
        $this->assertNotSame(500, $response->getStatusCode());
        // The stored row is untouched by the rejected request.
        $this->assertSame('High', $incident->fresh()->priority);
    }

    public function test_omitted_priority_still_succeeds_and_uses_the_database_default(): void
    {
        $this->actingAsSupabase($this->admin());

        // Dropping 'nullable' must not make priority required: Laravel skips
        // non-implicit rules for an absent key, so the column default applies
        // exactly as it did before.
        $response = $this->postJson('/api/incidents', $this->incidentPayload());

        $response->assertCreated()->assertJsonPath('data.priority', 'Normal');
        $this->assertSame('Normal', Incident::first()->priority);
    }

    public function test_a_valid_priority_is_still_accepted(): void
    {
        $this->actingAsSupabase($this->admin());

        $this->postJson('/api/incidents', $this->incidentPayload(['priority' => 'High']))
            ->assertCreated()
            ->assertJsonPath('data.priority', 'High');
    }

    // ===== Defect C — nullable timestamps must serialise, not explode =====
    //
    // audit_logs.created_at and app_notifications.created_at are both nullable
    // in the schema, but AuditLogResource and NotificationResource were the
    // only two resources in the application that dereferenced a timestamp
    // without a guard. Every sibling uses optional() or ?->. One null row
    // would therefore 500 the WHOLE collection response, taking down the Audit
    // Logs page and the notification bell rather than degrading a single row.
    //
    // The columns are deliberately left nullable — this is a serialisation
    // fix, not a schema change.

    public function test_audit_log_with_null_created_at_does_not_break_the_endpoint(): void
    {
        $admin = $this->admin();
        $this->actingAsSupabase($admin);

        $log = AuditLog::create([
            'user_id' => $admin->id,
            'action' => 'UPDATE',
            'module' => 'incidents',
            'target_type' => 'incident',
            'description' => 'Row with no timestamp',
        ]);
        // Timestamps are always set by Eloquent, so the only way to reach the
        // state the schema permits is to null it explicitly — which is what an
        // out-of-band insert or an import would produce.
        AuditLog::withoutTimestamps(fn () => $log->forceFill(['created_at' => null])->save());
        $this->assertNull($log->fresh()->created_at);

        $this->getJson('/api/audit-logs')
            ->assertOk()
            ->assertJsonPath('data.0.timestamp', null)
            ->assertJsonPath('data.0.details', 'Row with no timestamp');
    }

    public function test_notification_with_null_created_at_does_not_break_the_endpoint(): void
    {
        $this->actingAsSupabase($this->admin());

        $notification = AppNotification::create([
            'title' => 'Timestampless',
            'message' => 'Row with no timestamp',
            'type' => 'info',
            'read' => false,
        ]);
        AppNotification::withoutTimestamps(
            fn () => $notification->forceFill(['created_at' => null])->save()
        );
        $this->assertNull($notification->fresh()->created_at);

        $response = $this->getJson('/api/notifications')->assertOk();

        $row = collect($response->json('data'))
            ->firstWhere('title', 'Timestampless');
        $this->assertNotNull($row, 'The timestampless notification must still be returned.');
        $this->assertNull($row['timestamp']);
    }
}
