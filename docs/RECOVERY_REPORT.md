# Section 6.7 — Restore Procedures

## Recovery Objective

Demonstrate that a valid CDARS database backup can be restored into an
isolated, non-production environment, and that the restored schema and data
pass basic structural and referential-integrity checks — without connecting
to, modifying, or using credentials for the production Supabase database.

## Restore Test Environment

Disposable local PostgreSQL 17 container, run via Docker Desktop on the
operator's machine:

- Image: `postgres:17` (official image, pulled fresh for this test)
- Container: created with no persistent volume, so all restored data was
  discarded when the container was removed
- No network exposure beyond the local Docker host; no production
  credentials, hostnames, or connection strings were used at any point
- Container name `cdars_restore_test`, removed (`docker rm -f`) immediately
  after verification

## Restore Procedure

1. Started a disposable Postgres 17 container with a local-only, throwaway
   password (discarded with the container; not a production credential).
2. Waited for `pg_isready` to confirm the container was accepting
   connections.
3. Copied the existing manual dump file into the container:
   `scripts/backups/backup_before_mapping_coordinate_repair_2026-09-06.sql`
   (9,815 lines copied in full — line count matched the source file).
4. Restored the dump with `psql -f dump.sql` (plain-text SQL dump, so `psql`
   was the correct tool rather than `pg_restore`, which is for
   custom/directory-format dumps).
5. Ran verification queries (below).
6. Removed the container. No volume existed, so no restored data persisted
   anywhere after teardown.

## Verification

**Errors during restore:** 507 `ERROR` lines were emitted, all falling into
one category: statements referencing Supabase-platform-managed roles and
extensions that do not exist in a vanilla Postgres image — `anon`,
`authenticated`, `service_role`, `supabase_admin`, `supabase_auth_admin`,
`supabase_storage_admin`, `supabase_realtime_admin`, `dashboard_user`,
`pgbouncer`, `metabase_readonly`, and the `supabase_vault` extension/schema
(`vault.secrets`, `vault.decrypted_secrets`, vault crypto functions). These
are expected when restoring a Supabase dump outside Supabase's own
infrastructure — they are `GRANT`/`ALTER OWNER`/event-trigger/vault
statements, not application table or data definitions. **Zero** errors
referenced any CDARS application table, column, or constraint.

**Schema verification — tables (20/20 present):**
`app_notifications`, `audit_logs`, `cache`, `cache_locks`, `crime_types`,
`criminal_incident`, `criminals`, `failed_jobs`, `incident_evidence`,
`incident_victim`, `incidents`, `jobs`, `migrations`, `notification_reads`,
`password_reset_tokens`, `sessions`, `settings`, `sync_logs`, `users`,
`victims`.

**Foreign keys (10/10 present):**
`audit_logs_user_id_foreign`, `incidents_reported_by_foreign`,
`criminal_incident_criminal_id_foreign`,
`criminal_incident_incident_id_foreign`,
`criminals_related_incident_id_foreign`,
`incident_evidence_incident_id_foreign`,
`incident_victim_incident_id_foreign`, `incident_victim_victim_id_foreign`,
`notification_reads_app_notification_id_foreign`,
`notification_reads_user_id_foreign`.

**Indexes:** every one of the 20 restored tables has at least one index
(primary key at minimum); `incidents` has 7, `users` has 5, `criminals` has
4 — consistent with the indexing work already present in this branch.

**Representative row counts (post-restore):**

| Table | Row count |
|---|---|
| incidents | 129 |
| audit_logs | 210 |
| criminals | 25 |
| criminal_incident | 25 |
| incident_evidence | 55 |
| crime_types | 12 |
| victims | 12 |
| notification_reads | 26 |
| app_notifications | 12 |
| incident_victim | 13 |
| sync_logs | 10 |
| migrations | 28 |
| users | 5 |
| settings | 1 |

**Referential-integrity / orphan checks (all 0 orphans found):**

| Check | Result |
|---|---|
| `incident_victim` rows with no matching `incidents` row | 0 |
| `incident_victim` rows with no matching `victims` row | 0 |
| `criminal_incident` rows with no matching `incidents` row | 0 |
| `criminal_incident` rows with no matching `criminals` row | 0 |
| `incident_evidence` rows with no matching `incidents` row | 0 |
| `audit_logs` rows with a non-null `user_id` and no matching `users` row | 0 |

## Result

**PASS** — for the specific claim under test: the existing manual dump
(`backup_before_mapping_coordinate_repair_2026-09-06.sql`) is a structurally
valid backup that restores cleanly into an isolated Postgres 17 instance,
with all application tables, foreign keys, and indexes intact, and no
referential-integrity violations in the restored data.

This result validates **restorability of an existing manual dump**. It is
not, and cannot be, proof that an automated Supabase backup mechanism is
functioning — per confirmed Supabase dashboard evidence (see
`docs/BACKUP_LOG.md`), the current Free Plan does not provide scheduled
project backups at all, so no automated-backup artifact exists to test. A
manual database dump was successfully restored in an isolated PostgreSQL 17
environment, demonstrating that the backup can support database recovery;
closing the automated-backup gap itself would require a plan upgrade or a
separately managed backup solution, neither of which is in scope here.

## Production Safety

The production Supabase database (`crime-data-analytics`,
`ldktsqogjkeybpkymesb`) was **not modified, connected to, or used as a
credential source** at any point during this restore rehearsal. The restore
target was exclusively an ephemeral, no-volume local Docker container,
destroyed after verification.
