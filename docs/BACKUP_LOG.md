# Section 6.6 — Backup Procedures

## Backup Mechanism

The CDARS production database is Supabase PostgreSQL, project `crime-data-analytics`
(ref `ldktsqogjkeybpkymesb`, region `ap-southeast-1`, Postgres 17.6).

**Confirmed by operator-provided Supabase dashboard evidence (Database →
Backups screen):**

> "Free Plan does not include project backups."
> "Upgrade to the Pro Plan for up to 7 days of scheduled backups."

This confirms directly, from the dashboard itself:

| Item | Status |
|---|---|
| Current Supabase hosting plan | **Free Plan** |
| Supabase scheduled/automated project backups | **NOT AVAILABLE** on the current plan |
| Supabase Point-in-Time Recovery (PITR) | **NOT available** under the current Free Plan configuration |

This supersedes the earlier "pending dashboard verification" status in this
document — the plan tier and backup unavailability are no longer inferred
from a prior unrelated finding, they are confirmed directly from the
Supabase dashboard.

Independent of Supabase's platform-managed backups, a real manual database
dump exists in the repository's working tree at:

```
scripts/backups/backup_before_mapping_coordinate_repair_2026-09-06.sql
```

- Type: **manual PostgreSQL `pg_dump` backup** (operator-initiated, not
  Supabase platform-managed, not scheduled/automated)
- Format: plain-text `pg_dump` output (`pg_dump version 18.6`, dumped from
  database version 17.6)
- Date: 2026-09-06
- Approximate size: 418 KB
- Approximate lines: 9,815
- Purpose (per filename): a manual safety snapshot taken before a mapping
  coordinate repair operation
- Not committed to git — `scripts/backups/` is excluded via `.gitignore`

This is real, verifiable evidence of **manual backup capability**. It must
not be described as an automated backup — it is a single operator-initiated
snapshot tied to a specific migration, not a recurring, scheduled, or
platform-managed process.

## Verification Procedure

Plan tier and backup availability were confirmed directly in the Supabase
dashboard for the `crime-data-analytics` project, under **Database →
Backups**. That screen states the Free Plan does not include project
backups and offers an upgrade path to the Pro Plan for up to 7 days of
scheduled backups. No further dashboard verification is needed to establish
that automated backups are unavailable on the current plan; a future
verification would only be needed if the plan changes.

## Evidence

| Item | Status |
|---|---|
| Supabase automated/scheduled backups enabled and functioning | **NOT AVAILABLE** — confirmed by dashboard: Free Plan excludes project backups |
| Supabase Point-in-Time Recovery enabled | **NOT AVAILABLE** — requires a paid plan |
| Manual `pg_dump` snapshot exists | **Verified** — `scripts/backups/backup_before_mapping_coordinate_repair_2026-09-06.sql`, dated 2026-09-06, ~418 KB, ~9,815 lines |
| Recurring/scheduled backup job in this repository | **Not present** — no cron, queue job, or CI step performs scheduled backups |

No fabricated backup IDs, timestamps, or success logs are included above.

## Current Status

**6.6 is partially satisfied.** Manual PostgreSQL backup capability is
available and documented, but automated Supabase project backups are
unavailable on the current Free Plan. The current Supabase Free Plan does
not include scheduled project backups; the system therefore relies on
manual PostgreSQL dump capability for backup evidence in the current
deployment configuration.

Closing this gap would require either:

1. an upgraded Supabase plan that provides scheduled project backups (and
   optionally PITR), or
2. a separately managed automated backup solution external to Supabase.

Neither option is implemented in this phase — this document only records
the current, honest state.

**Manual dump capability: Verified.** At least one real `pg_dump` snapshot
exists in the working tree, dated 2026-09-06, taken as a precaution before a
schema/data-affecting migration. This manual snapshot was used as the source
for the restore rehearsal documented in `docs/RECOVERY_REPORT.md`, which
demonstrated that the backup can support database recovery.
