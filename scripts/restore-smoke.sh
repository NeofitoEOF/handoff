#!/usr/bin/env sh
set -eu

ADMIN_HOST="${PGHOST:-127.0.0.1}"
ADMIN_PORT="${PGPORT:-5432}"
ADMIN_USER="${PGUSER:-handoff_admin}"
ADMIN_PASSWORD="${PGPASSWORD:-handoff_admin}"
SOURCE_DB="${SOURCE_DB:-handoff}"
RESTORE_DB="${RESTORE_DB:-handoff_restore}"
BACKUP_FILE="${BACKUP_FILE:-/tmp/handoff-restore-smoke.dump}"

export PGPASSWORD="$ADMIN_PASSWORD"

echo "[restore-smoke] creating logical backup"
docker run --rm --network host   -e PGPASSWORD="$ADMIN_PASSWORD" postgres:16-alpine   pg_dump -h "$ADMIN_HOST" -p "$ADMIN_PORT" -U "$ADMIN_USER" -d "$SOURCE_DB" -Fc   > "$BACKUP_FILE"

test -s "$BACKUP_FILE"

echo "[restore-smoke] recreating target database"
docker run --rm --network host   -e PGPASSWORD="$ADMIN_PASSWORD" postgres:16-alpine   psql -h "$ADMIN_HOST" -p "$ADMIN_PORT" -U "$ADMIN_USER" -d postgres   -v ON_ERROR_STOP=1   -c "DROP DATABASE IF EXISTS \"$RESTORE_DB\";"   -c "CREATE DATABASE \"$RESTORE_DB\";"

echo "[restore-smoke] restoring backup"
cat "$BACKUP_FILE" | docker run --rm -i --network host   -e PGPASSWORD="$ADMIN_PASSWORD" postgres:16-alpine   pg_restore -h "$ADMIN_HOST" -p "$ADMIN_PORT" -U "$ADMIN_USER" -d "$RESTORE_DB"   --no-owner --no-privileges

echo "[restore-smoke] verifying restored schema"
docker run --rm --network host   -e PGPASSWORD="$ADMIN_PASSWORD" postgres:16-alpine   psql -h "$ADMIN_HOST" -p "$ADMIN_PORT" -U "$ADMIN_USER" -d "$RESTORE_DB"   -v ON_ERROR_STOP=1   -c "SELECT count(*) AS migration_count FROM schema_migrations;"   -c "SELECT to_regclass('public.audit_events') AS audit_events_table;"   -c "SELECT to_regclass('public.snapshots') AS snapshots_table;"

echo "[restore-smoke] success"
