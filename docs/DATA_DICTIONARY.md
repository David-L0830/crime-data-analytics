# Data Dictionary

## 1. Purpose and Scope

This document describes the database schema of the BADAC Crime Data Analytics &
Reporting System (CDARS) as defined by the application's Laravel migrations. It
is intended as a technical reference and as a formal evidence artifact for
system verification.

Every table, column, type, default, constraint and foreign key recorded here is
derived from the migration source in `backend/database/migrations/` and, where
noted, cross-checked against the Eloquent models in `backend/app/Models/`.
Nothing in this document is inferred: where the source does not establish a
business meaning for a column, none is asserted.

**Scope covers 13 application/domain tables and 6 framework-managed tables**
that exist in the current schema. Tables that were created by an earlier
migration and subsequently dropped are listed in §5 so their absence is
explicit rather than ambiguous.

### Conventions used in this document

- **Type** — the PostgreSQL type produced by the Laravel schema-builder call in
  the migration. The originating builder method is named where it is not
  obvious (for example `$table->id()` → `bigint`, auto-incrementing). On
  PostgreSQL, `(unsigned)` reflects the Laravel schema-builder method used; it
  is not a PostgreSQL-enforced non-negative constraint.
- **Nullable** — `Yes` only where the migration calls `->nullable()`.
- **Default** — recorded only where the migration explicitly calls
  `->default(...)` or `->useCurrent()`. A blank cell means no database default
  is defined.
- **Delete Behavior** — recorded only where the migration explicitly declares
  one (`->cascadeOnDelete()` / `->nullOnDelete()`).
- **Application-level value sets** — several columns hold a constrained set of
  values enforced in application code (model constants and FormRequest
  validation) rather than by a database `CHECK` constraint or enum type. These
  are documented as *application-enforced* and are explicitly **not** database
  constraints.

---

## 2. Application / Domain Tables

### users

Application accounts. Authentication itself is delegated to Supabase Auth; this
table holds the application-side profile, role and activation state, linked to
the Supabase identity by `supabase_user_id`.

| Column | Type | Nullable | Default | PK | Unique | Foreign Key | Delete Behavior | Description |
|---|---|---|---|---|---|---|---|---|
| `id` | bigint (auto-increment) | No | — | Yes | — | — | — | Primary key. |
| `name` | varchar(255) | No | — | — | — | — | — | Display name. |
| `username` | varchar(255) | No | — | — | Yes | — | — | Login/display username. |
| `email` | varchar(255) | No | — | — | Yes | — | — | Email address. |
| `google_id` | varchar(255) | Yes | — | — | Yes | — | — | Google account identifier. Added by `2025_01_03_000001`. |
| `supabase_user_id` | uuid | Yes | — | — | Yes | — | — | Supabase Auth user id. Links the local account to its Supabase identity. Added by `2025_01_05_000001`. |
| `two_factor_secret` | text | Yes | — | — | — | — | — | Legacy Laravel-side TOTP secret column. Added by `2025_01_04_000001`. See note below. |
| `two_factor_recovery_codes` | text | Yes | — | — | — | — | — | Legacy Laravel-side recovery codes column. See note below. |
| `two_factor_confirmed_at` | timestamp | Yes | — | — | — | — | — | Legacy Laravel-side TOTP confirmation timestamp. See note below. |
| `email_verified_at` | timestamp | Yes | — | — | — | — | — | Email verification timestamp. |
| `password` | varchar(255) | Yes | — | — | — | — | — | Originally `NOT NULL`; made nullable by `2025_02_01_000001`. Not populated for accounts created after the Supabase auth migration. |
| `role` | varchar(255) | No | `'badac_admin'` | — | — | — | — | Application role. Application-enforced values: `badac_admin`, `encoder`, `badac_readonly` (`User::ROLE_*` constants). Not a database enum. |
| `is_active` | boolean | No | `true` | — | — | — | — | Whether the account may sign in. Added by `2025_01_02_000001`. |
| `avatar_path` | varchar(255) | Yes | — | — | — | — | — | Stored avatar path. Added by `2025_01_07_000001`. |
| `remember_token` | varchar(100) | Yes | — | — | — | — | — | Laravel "remember me" token (`$table->rememberToken()`). |
| `created_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |
| `updated_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |

> **Note on the `two_factor_*` columns.** These columns exist in the schema from
> `2025_01_04_000001`. No later migration drops them. This document records
> their presence in the schema; it does not assert how (or whether) current
> application code populates them.

---

### incidents

The core domain record: one row per reported crime incident.

| Column | Type | Nullable | Default | PK | Unique | Foreign Key | Delete Behavior | Description |
|---|---|---|---|---|---|---|---|---|
| `id` | bigint (auto-increment) | No | — | Yes | — | — | — | Primary key. |
| `incident_code` | varchar(255) | No | — | — | Yes | — | — | Human-facing incident identifier (e.g. `INC-00001`). |
| `case_number` | varchar(255) | No | — | — | Yes | — | — | Human-facing case identifier (e.g. `CN-2025-0001`). |
| `crime_type` | varchar(255) | No | — | — | — | — | — | Crime type name. Indexed. Validated against `crime_types.name` in application code. |
| `category` | varchar(255) | Yes | — | — | — | — | — | Crime category. |
| `incident_date` | date | No | — | — | — | — | — | Date of the incident. Indexed. |
| `incident_time` | time | Yes | — | — | — | — | — | Time of the incident. |
| `street` | varchar(255) | Yes | — | — | — | — | — | Street / location text. |
| `sitio` | varchar(255) | Yes | — | — | — | — | — | Sitio. Indexed. |
| `latitude` | decimal(10,7) | Yes | — | — | — | — | — | Latitude. |
| `longitude` | decimal(10,7) | Yes | — | — | — | — | — | Longitude. |
| `victim_name` | varchar(255) | Yes | — | — | — | — | — | Victim name recorded on the incident. |
| `victim_age` | smallint (unsignedTinyInteger) | Yes | — | — | — | — | — | Victim age. |
| `victim_gender` | varchar(255) | Yes | — | — | — | — | — | Victim gender. |
| `suspect_name` | varchar(255) | Yes | — | — | — | — | — | Suspect name recorded on the incident. |
| `suspect_age` | smallint (unsignedTinyInteger) | Yes | — | — | — | — | — | Suspect age. |
| `reporting_officer` | varchar(255) | Yes | — | — | — | — | — | Reporting officer. |
| `investigating_officer` | varchar(255) | Yes | — | — | — | — | — | Investigating officer. |
| `badge_number` | varchar(255) | Yes | — | — | — | — | — | Officer badge number. |
| `unit` | varchar(255) | Yes | — | — | — | — | — | Officer unit. |
| `status` | varchar(255) | No | `'Open'` | — | — | — | — | Record status. Indexed. Application-enforced values: `Open`, `Under Investigation`, `Solved`, `Closed`, `Archived` (`Incident::STATUSES`). Not a database enum. |
| `previous_status` | varchar(255) | Yes | — | — | — | — | — | Status held immediately before archiving; read back on restore. Added by `2026_09_03_000001`. |
| `priority` | varchar(255) | No | `'Normal'` | — | — | — | — | Priority. |
| `description` | text | Yes | — | — | — | — | — | Narrative description. |
| `evidence` | varchar(255) | Yes | — | — | — | — | — | Legacy single free-text evidence field. Retained; superseded by the `incident_evidence` table. |
| `complainant_is_victim` | boolean | No | `true` | — | — | — | — | Whether the complainant and the victim are the same person. Added by `2026_08_28_000002`. |
| `complainant_name` | varchar(150) | Yes | — | — | — | — | — | Complainant name, when distinct from the victim. |
| `complainant_relationship` | varchar(100) | Yes | — | — | — | — | — | Complainant's relationship to the victim. |
| `complainant_contact` | varchar(50) | Yes | — | — | — | — | — | Complainant contact number. |
| `complainant_address` | varchar(255) | Yes | — | — | — | — | — | Complainant address. |
| `reported_by` | bigint | Yes | — | — | — | `users.id` | `SET NULL` | Account that recorded the incident. |
| `synced_at` | timestamp | Yes | — | — | — | — | — | Timestamp column present in the schema. |
| `created_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |
| `updated_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |

**Indexes:** `sitio`, `crime_type`, `status`, `incident_date` (plus the unique
constraints on `incident_code` and `case_number`).

---

### incident_evidence

Structured, repeatable evidence items belonging to an incident. Replaces the
single free-text `incidents.evidence` column for new records; that column is
retained and was not dropped. Eloquent model: `App\Models\Evidence`
(`protected $table = 'incident_evidence'`).

| Column | Type | Nullable | Default | PK | Unique | Foreign Key | Delete Behavior | Description |
|---|---|---|---|---|---|---|---|---|
| `id` | bigint (auto-increment) | No | — | Yes | — | — | — | Primary key. |
| `incident_id` | bigint | No | — | — | Composite | `incidents.id` | `CASCADE` | Owning incident. Indexed. |
| `evidence_code` | varchar(50) | No | — | — | Composite | — | — | Evidence reference identifier (e.g. `EV-001`). Unique per incident, not globally. |
| `description` | text | No | — | — | — | — | — | What the evidence item is. |
| `created_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |
| `updated_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |

**Constraints:** `UNIQUE (incident_id, evidence_code)`; index on `incident_id`.
Row-level security enabled by `2026_08_29_000001`.

---

### criminals

Criminal / suspect profile records.

| Column | Type | Nullable | Default | PK | Unique | Foreign Key | Delete Behavior | Description |
|---|---|---|---|---|---|---|---|---|
| `id` | bigint (auto-increment) | No | — | Yes | — | — | — | Primary key. |
| `criminal_code` | varchar(255) | No | — | — | Yes | — | — | Human-facing criminal identifier. |
| `full_name` | varchar(255) | No | — | — | — | — | — | Full name. Indexed. Deliberately not unique. |
| `alias` | varchar(255) | Yes | — | — | — | — | — | Alias / known-as. Added by `2025_01_01_000016`. |
| `date_of_birth` | date | Yes | — | — | — | — | — | Date of birth. |
| `gender` | varchar(255) | Yes | — | — | — | — | — | Gender. |
| `civil_status` | varchar(255) | Yes | — | — | — | — | — | Civil status. Added by `2025_01_01_000016`. |
| `nationality` | varchar(255) | Yes | — | — | — | — | — | Nationality. Added by `2025_01_01_000016`. |
| `address` | varchar(255) | Yes | — | — | — | — | — | Address. |
| `sitio` | varchar(255) | Yes | — | — | — | — | — | Sitio. Added by `2025_01_01_000016`. |
| `contact_number` | varchar(255) | Yes | — | — | — | — | — | Contact number. Added by `2025_01_01_000016`. |
| `photo_path` | varchar(255) | Yes | — | — | — | — | — | Stored photo path. Added by `2025_01_01_000016`. |
| `physical_description` | varchar(255) | Yes | — | — | — | — | — | Free-text physical description. Retained for backward compatibility alongside the structured fields below. |
| `height` | varchar(255) | Yes | — | — | — | — | — | Height. Added by `2025_01_01_000016`. |
| `weight` | varchar(255) | Yes | — | — | — | — | — | Weight. Added by `2025_01_01_000016`. |
| `build` | varchar(255) | Yes | — | — | — | — | — | Build. Added by `2025_01_01_000016`. |
| `hair_color` | varchar(255) | Yes | — | — | — | — | — | Hair colour. Added by `2025_01_01_000016`. |
| `eye_color` | varchar(255) | Yes | — | — | — | — | — | Eye colour. Added by `2025_01_01_000016`. |
| `distinguishing_marks` | varchar(255) | Yes | — | — | — | — | — | Distinguishing marks. Added by `2025_01_01_000016`. |
| `status` | varchar(255) | No | `'Active'` | — | — | — | — | Record status. Indexed. Application-enforced values: `Active`, `Wanted`, `Incarcerated`, `Released`, `Deceased`, `Archived` (`Criminal::STATUSES`). Not a database enum. |
| `previous_status` | varchar(255) | Yes | — | — | — | — | — | Status held before archiving; read back on restore. Added by `2026_08_26_000001`. |
| `charges` | json | Yes | — | — | — | — | — | Charges. Cast to `array` by the model. |
| `notes` | text | Yes | — | — | — | — | — | Free-text notes. |
| `related_incident_id` | bigint | Yes | — | — | — | `incidents.id` | `SET NULL` | Legacy single-incident link. Superseded by the `criminal_incident` junction, which is the supported many-to-many path. |
| `related_case_number` | varchar(255) | Yes | — | — | — | — | — | Legacy related case number text. |
| `created_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |
| `updated_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |

**Indexes:** `full_name`, `status` (plus the unique constraint on `criminal_code`).

---

### victims

Victim records. Victims are an independent entity and are related to criminals
only indirectly, through a shared case (`incidents` row) via `incident_victim`.

| Column | Type | Nullable | Default | PK | Unique | Foreign Key | Delete Behavior | Description |
|---|---|---|---|---|---|---|---|---|
| `id` | bigint (auto-increment) | No | — | Yes | — | — | — | Primary key. |
| `victim_code` | varchar(255) | No | — | — | Yes | — | — | Human-facing victim identifier. |
| `full_name` | varchar(255) | No | — | — | — | — | — | Full name. Indexed. |
| `alias` | varchar(255) | Yes | — | — | — | — | — | Alias / known-as. |
| `gender` | varchar(255) | Yes | — | — | — | — | — | Gender. |
| `date_of_birth` | date | Yes | — | — | — | — | — | Date of birth. |
| `civil_status` | varchar(255) | Yes | — | — | — | — | — | Civil status. |
| `nationality` | varchar(255) | Yes | — | — | — | — | — | Nationality. |
| `contact_number` | varchar(255) | Yes | — | — | — | — | — | Contact number. |
| `address` | varchar(255) | Yes | — | — | — | — | — | Address. |
| `status` | varchar(255) | No | `'Active'` | — | — | — | — | Record status. Added by `2025_01_06_000001`. Application-enforced values: `Active`, `Archived` (`Victim::STATUSES`). Not a database enum. |
| `previous_status` | varchar(255) | Yes | — | — | — | — | — | Status held before archiving; read back on restore. Added by `2026_08_26_000001`. |
| `created_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |
| `updated_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |

**Indexes:** `full_name` (plus the unique constraint on `victim_code`).

---

### incident_victim

Junction table implementing the many-to-many relationship between cases
(`incidents`) and `victims`. The migration states the intent explicitly: one row
per (case, victim) pair — a case may have zero, one or many victims, and the
same victim may appear on more than one case.

| Column | Type | Nullable | Default | PK | Unique | Foreign Key | Delete Behavior | Description |
|---|---|---|---|---|---|---|---|---|
| `id` | bigint (auto-increment) | No | — | Yes | — | — | — | Primary key. |
| `incident_id` | bigint | No | — | — | Composite | `incidents.id` | `CASCADE` | The case. |
| `victim_id` | bigint | No | — | — | Composite | `victims.id` | `CASCADE` | The victim. |
| `created_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |
| `updated_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |

**Constraints:** `UNIQUE (incident_id, victim_id)`.

---

### criminal_incident

Junction table implementing the many-to-many relationship between `criminals`
and cases (`incidents`). Introduced by `2025_01_01_000016` to replace the single
`criminals.related_incident_id` link; that migration backfilled each existing
`related_incident_id` into this table.

| Column | Type | Nullable | Default | PK | Unique | Foreign Key | Delete Behavior | Description |
|---|---|---|---|---|---|---|---|---|
| `id` | bigint (auto-increment) | No | — | Yes | — | — | — | Primary key. |
| `criminal_id` | bigint | No | — | — | Composite | `criminals.id` | `CASCADE` | The criminal. |
| `incident_id` | bigint | No | — | — | Composite | `incidents.id` | `CASCADE` | The case. |
| `created_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |
| `updated_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |

**Constraints:** `UNIQUE (criminal_id, incident_id)`.

---

### crime_types

The configurable crime-type vocabulary, replacing a hard-coded frontend array.
`color` is stored on the row so a crime type keeps a stable colour across
sessions, users and machines.

| Column | Type | Nullable | Default | PK | Unique | Foreign Key | Delete Behavior | Description |
|---|---|---|---|---|---|---|---|---|
| `id` | bigint (auto-increment) | No | — | Yes | — | — | — | Primary key. |
| `name` | varchar(255) | No | — | — | Yes | — | — | Crime type name. |
| `color` | varchar(7) | No | — | — | — | — | — | Hex colour used for map markers and legends. |
| `is_active` | boolean | No | `true` | — | — | — | — | Whether the type is offered in the UI. |
| `created_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |
| `updated_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |

**Seeded values.** The creating migration seeds the twelve types that were
previously hard-coded in the frontend — `Theft`, `Robbery`, `Assault`,
`Homicide`, `Murder`, `Drug Offense`, `Fraud`, `Vandalism`, `Cybercrime`,
`Domestic Violence`, `Physical Injury`, `Carnapping` — and additionally
creates a row for every distinct `incidents.crime_type` value already present
in live data. These are seeded rows, not a database constraint; the table is
editable at runtime.

Row-level security enabled by `2026_08_29_000001`.

---

### audit_logs

Append-only record of user actions.

| Column | Type | Nullable | Default | PK | Unique | Foreign Key | Delete Behavior | Description |
|---|---|---|---|---|---|---|---|---|
| `id` | bigint (auto-increment) | No | — | Yes | — | — | — | Primary key. |
| `user_id` | bigint | Yes | — | — | — | `users.id` | `SET NULL` | Account that performed the action. Nullable so the row survives account removal. |
| `action` | varchar(255) | No | — | — | — | — | — | Action performed. Indexed. Values written by application code include `LOGIN`, `LOGOUT`, `CREATE`, `UPDATE`, `VIEW`, `ARCHIVE`, `RESTORE`, `REPORT_EXPORTED`. Not a database enum. |
| `module` | varchar(255) | Yes | — | — | — | — | — | Module the action occurred in. |
| `target_type` | varchar(255) | Yes | — | — | — | — | — | Type of the affected entity. |
| `description` | text | Yes | — | — | — | — | — | Human-readable description of the action. |
| `ip_address` | varchar(45) | Yes | — | — | — | — | — | Caller IP address. Width accommodates IPv6. |
| `created_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. Indexed. |
| `updated_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |

**Indexes:** `action`, `created_at`.

---

### app_notifications

System-wide in-application announcements. The announcement is shared; per-user
read state is held separately in `notification_reads`.

| Column | Type | Nullable | Default | PK | Unique | Foreign Key | Delete Behavior | Description |
|---|---|---|---|---|---|---|---|---|
| `id` | bigint (auto-increment) | No | — | Yes | — | — | — | Primary key. |
| `title` | varchar(255) | No | — | — | — | — | — | Notification title. |
| `message` | text | No | — | — | — | — | — | Notification body. |
| `type` | varchar(255) | No | `'info'` | — | — | — | — | Notification type. The migration comment documents `info`, `success`, `warning`. Not a database enum. |
| `read` | boolean | No | `false` | — | — | — | — | Legacy system-wide read flag. Retained and still honoured; superseded by `notification_reads` for per-user state. |
| `audience_roles` | varchar(255) | Yes | — | — | — | — | — | Roles the announcement is for, stored as a delimiter-wrapped comma list (e.g. `,badac_admin,`) so membership is a portable `LIKE` test on both PostgreSQL and SQLite. `NULL` means every authenticated role. Added by `2026_08_28_000005`. |
| `created_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |
| `updated_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |

---

### notification_reads

Per-user read state for `app_notifications`. Records that a given user has read
a given notification.

| Column | Type | Nullable | Default | PK | Unique | Foreign Key | Delete Behavior | Description |
|---|---|---|---|---|---|---|---|---|
| `id` | bigint (auto-increment) | No | — | Yes | — | — | — | Primary key. |
| `app_notification_id` | bigint | No | — | — | Composite | `app_notifications.id` | `CASCADE` | The notification. |
| `user_id` | bigint | No | — | — | Composite | `users.id` | `CASCADE` | The user who read it. Indexed. |
| `read_at` | timestamp | No | — | — | — | — | — | When the user read it. Note: **not nullable** and has no default. |

> This table has **no** `created_at` / `updated_at` columns — the migration does
> not call `$table->timestamps()`.

**Constraints:** `UNIQUE (app_notification_id, user_id)`; index on `user_id`.
Row-level security enabled by `2026_08_29_000001`.

---

### settings

Single-row configuration for the barangay. `Setting::current()` uses
`firstOrCreate(['id' => 1], ...)`, so in practice one row (`id = 1`) is used.

| Column | Type | Nullable | Default | PK | Unique | Foreign Key | Delete Behavior | Description |
|---|---|---|---|---|---|---|---|---|
| `id` | bigint (auto-increment) | No | — | Yes | — | — | — | Primary key. |
| `barangay` | varchar(255) | No | `'Barangay 178'` | — | — | — | — | Barangay name. |
| `population` | integer (unsigned) | Yes | — | — | — | — | — | Population figure. Used as the denominator for the crime-rate-per-1,000 KPI. |
| `threshold` | integer (unsigned) | No | `5` | — | — | — | — | Configured threshold value. |
| `hotspot_threshold` | integer (unsigned) | No | `3` | — | — | — | — | Incident count at or above which a sitio qualifies as a hotspot. |
| `categories` | json | Yes | — | — | — | — | — | Category vocabulary. Cast to `array` by the model. |
| `created_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |
| `updated_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |

---

### sync_logs

| Column | Type | Nullable | Default | PK | Unique | Foreign Key | Delete Behavior | Description |
|---|---|---|---|---|---|---|---|---|
| `id` | bigint (auto-increment) | No | — | Yes | — | — | — | Primary key. |
| `status` | varchar(255) | No | `'completed'` | — | — | — | — | Run status. The migration comment documents `completed`, `failed`. Not a database enum. |
| `records_received` | integer (unsigned) | No | `0` | — | — | — | — | Record count for the run. |
| `source` | varchar(255) | Yes | — | — | — | — | — | Source label for the run. |
| `created_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |
| `updated_at` | timestamp | Yes | — | — | — | — | — | From `$table->timestamps()`. |

> **Status of this table.** The creating migration describes it as supporting
> frontend sync-status widgets. In the current codebase no application code
> path writes to this table — the only writer is `SyncLogSeeder`, which inserts
> demonstration rows. The Dashboard KPI cards that previously read from it were
> removed. The table, model (`App\Models\SyncLog`), controller
> (`SyncLogController`) and `GET /api/sync-logs` endpoint remain in place. This
> note records the observed state of the code; it does not assert a plan for
> the table.

---

## 3. Relationships

Derived from the foreign keys and junction tables defined in the migrations.

| Relationship | Type | Implemented by | Delete Behavior |
|---|---|---|---|
| `incidents` → `users` | Many-to-one | `incidents.reported_by` → `users.id` | `SET NULL` |
| `incidents` ↔ `victims` | **Many-to-many** | `incident_victim` junction | `CASCADE` on both sides |
| `incidents` ↔ `criminals` | **Many-to-many** | `criminal_incident` junction | `CASCADE` on both sides |
| `criminals` → `incidents` | Many-to-one (legacy) | `criminals.related_incident_id` → `incidents.id` | `SET NULL` |
| `incident_evidence` → `incidents` | Many-to-one | `incident_evidence.incident_id` → `incidents.id` | `CASCADE` |
| `audit_logs` → `users` | Many-to-one | `audit_logs.user_id` → `users.id` | `SET NULL` |
| `notification_reads` → `app_notifications` | Many-to-one | `notification_reads.app_notification_id` | `CASCADE` |
| `notification_reads` → `users` | Many-to-one | `notification_reads.user_id` | `CASCADE` |

**Notes.**

- `criminals` and `victims` have **no direct foreign key to each other**. They
  are associated only indirectly, through a shared case — a `criminals` row and
  a `victims` row that both link to the same `incidents` row. The
  `2025_01_01_000017` migration states this design intent explicitly.
- `crime_types` has **no foreign key** from `incidents.crime_type`. The
  relationship is by name and is enforced in application code
  (`Rule::exists('crime_types', 'name')` in the incident FormRequests), not by a
  database constraint.
- Two relationships to `incidents` exist for criminals: the legacy single
  `related_incident_id` column and the `criminal_incident` junction. Both are
  present in the schema.

---

## 4. Framework Tables

Laravel-managed tables. These support framework subsystems (cache, queue,
session, password reset) rather than the crime-data domain.

### cache

| Column | Type | Nullable | Default | PK | Description |
|---|---|---|---|---|---|
| `key` | varchar(255) | No | — | Yes | Cache key. |
| `value` | mediumtext | No | — | — | Serialized cached value. |
| `expiration` | integer | No | — | — | Expiry as a Unix timestamp. |

### cache_locks

| Column | Type | Nullable | Default | PK | Description |
|---|---|---|---|---|---|
| `key` | varchar(255) | No | — | Yes | Lock key. |
| `owner` | varchar(255) | No | — | — | Lock owner token. |
| `expiration` | integer | No | — | — | Expiry as a Unix timestamp. |

### jobs

| Column | Type | Nullable | Default | PK | Description |
|---|---|---|---|---|---|
| `id` | bigint (auto-increment) | No | — | Yes | Primary key. |
| `queue` | varchar(255) | No | — | — | Queue name. Indexed. |
| `payload` | longtext | No | — | — | Serialized job payload. |
| `attempts` | smallint (unsignedTinyInteger) | No | — | — | Attempt count. |
| `reserved_at` | integer (unsigned) | Yes | — | — | Reservation timestamp. |
| `available_at` | integer (unsigned) | No | — | — | Availability timestamp. |
| `created_at` | integer (unsigned) | No | — | — | Creation timestamp. Note: an integer column, not a Laravel `timestamps()` pair. |

### failed_jobs

| Column | Type | Nullable | Default | PK | Unique | Description |
|---|---|---|---|---|---|---|
| `id` | bigint (auto-increment) | No | — | Yes | — | Primary key. |
| `uuid` | varchar(255) | No | — | — | Yes | Job UUID. |
| `connection` | text | No | — | — | — | Queue connection. |
| `queue` | text | No | — | — | — | Queue name. |
| `payload` | longtext | No | — | — | — | Serialized job payload. |
| `exception` | longtext | No | — | — | — | Captured exception. |
| `failed_at` | timestamp | No | `CURRENT_TIMESTAMP` (`useCurrent()`) | — | — | Failure time. |

### sessions

| Column | Type | Nullable | Default | PK | Description |
|---|---|---|---|---|---|
| `id` | varchar(255) | No | — | Yes | Session id. |
| `user_id` | bigint | Yes | — | — | Indexed. Declared with `foreignId(...)->nullable()->index()` — **indexed but no foreign-key constraint is declared**. |
| `ip_address` | varchar(45) | Yes | — | — | Client IP address. |
| `user_agent` | text | Yes | — | — | Client user agent. |
| `payload` | longtext | No | — | — | Serialized session payload. |
| `last_activity` | integer | No | — | — | Last activity timestamp. Indexed. |

### password_reset_tokens

| Column | Type | Nullable | Default | PK | Description |
|---|---|---|---|---|---|
| `email` | varchar(255) | No | — | Yes | Email address the token belongs to. |
| `token` | varchar(255) | No | — | — | Reset token. |
| `created_at` | timestamp | Yes | — | — | Token creation time. |

> **`migrations` table.** Laravel's own migration-tracking table exists in the
> database but is created by the framework rather than by any migration file in
> this repository, so it has no source definition to document here.

---

## 5. Tables Created and Later Dropped

These tables appear in the migration history but are **not** part of the current
schema. They are listed so their absence is explicit.

| Table | Created by | Dropped by | Note |
|---|---|---|---|
| `personal_access_tokens` | `2025_01_01_000003` | `2025_02_01_000001` | Laravel Sanctum token table. Dropped when authentication moved to Supabase. |
| `residents` | `2025_01_01_000011` | `2026_08_21_200721` | Resident Registry module. The drop migration's `down()` recreates it, so its historical shape is recoverable, but it does not exist in the current schema. |

---

## 6. Row-Level Security

Migration `2026_08_29_000001` issues
`ALTER TABLE public."<table>" ENABLE ROW LEVEL SECURITY` for three tables:

- `crime_types`
- `incident_evidence`
- `notification_reads`

The migration guards on PostgreSQL support and on table existence, so it is a
no-op on the SQLite test database. This document records only what this
migration does. It does not describe RLS configuration applied to other tables
outside the migration source, and it makes no claim about the resulting access
behaviour.

---

## 7. Source of Truth

The schema described here is derived from the 28 migration files in
`backend/database/migrations/`, cross-checked against the Eloquent models in
`backend/app/Models/` for casts, custom table names and application-level value
sets.

**The migrations remain authoritative.** Where this document and the migration
source disagree, the migration source is correct and this document should be
corrected. Column names, types, defaults and constraints recorded above were
transcribed from the migration definitions; application-level value sets (role
names, status vocabularies, audit action names) were read from model constants
and controller source and are identified as application-enforced rather than as
database constraints.

Generated against `origin/main` at commit `b891172`.
