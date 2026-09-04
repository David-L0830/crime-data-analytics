# Disaster Recovery Evidence Template

> **Template only — this file is not evidence that a backup or restore has been performed.**
> Copy this file per rehearsal (e.g. `DR_EVIDENCE_2026-03-02.md`) and fill in the placeholders. Do not put real production values, emails, names, hostnames, credentials, connection strings, or row contents into this file — use non-identifying placeholders (e.g. `<redacted>`, row counts, hashes) instead of actual data.

## Backup

| Field | Value |
|---|---|
| Backup date/time | `<YYYY-MM-DD HH:MM timezone>` |
| Operator | `<name or role>` |
| Dump filename | `<cdars-YYYYMMDD-HHMM.dump>` |
| Dump size | `<size>` |

## Dump verification (`pg_restore --list`)

```
<paste pg_restore --list output summary here, or note pass/fail per expected table>
```

| Table | Present in listing? |
|---|---|
| `<table name>` | `<yes/no>` |

## Aggregate row counts (pre-restore, source database)

| Table | Row count |
|---|---|
| `<table name>` | `<count>` |

## Restore

| Field | Value |
|---|---|
| Restore target type | `<new/non-production database, local, etc.>` |
| Restore exit status | `<exit code / success / failure>` |

## Aggregate row counts (post-restore, target database)

| Table | Row count |
|---|---|
| `<table name>` | `<count>` |

## Referential-integrity / orphan checks

| Check | Result |
|---|---|
| `<e.g. incidents with no matching crime_types row>` | `<pass/fail, count>` |

## Domain-integrity checks

| Check | Result |
|---|---|
| `<e.g. status values within allowed enum>` | `<pass/fail, count>` |

## Rehearsal

| Field | Value |
|---|---|
| Rehearsal date | `<YYYY-MM-DD>` |
| Cleanup confirmation | `<temporary restore target destroyed: yes/no, date>` |

## Notes

`<any deviations, follow-ups, or issues found during this rehearsal>`
