#!/bin/sh
# Creates audit_writer, the ONLY account service-audit connects with.
#
# INSERT and SELECT on audit_events, nothing else: no UPDATE, no DELETE, no
# TRUNCATE, no DDL, and it does not own the table (so it cannot disable the
# append-only triggers from 01-schema.sql). A shell script rather than SQL only
# so the password can come from the environment instead of being written into
# a file.
set -eu

: "${AUDIT_DB_APP_PASSWORD:?AUDIT_DB_APP_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     -v app_password="$AUDIT_DB_APP_PASSWORD" <<'SQL'
CREATE ROLE audit_writer LOGIN PASSWORD :'app_password';
REVOKE ALL ON audit_events FROM PUBLIC;
GRANT CONNECT ON DATABASE audit TO audit_writer;
GRANT USAGE ON SCHEMA public TO audit_writer;
GRANT INSERT, SELECT ON audit_events TO audit_writer;
SQL
