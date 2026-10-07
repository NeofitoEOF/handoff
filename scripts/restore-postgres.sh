#!/usr/bin/env sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <backup.dump>" >&2
  exit 2
fi

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP="$1"

echo "[restore] validating archive"
pg_restore --list "${BACKUP}" >/dev/null

echo "[restore] restoring into target database"
pg_restore   --dbname="${DATABASE_URL}"   --clean   --if-exists   --no-owner   --no-privileges   "${BACKUP}"

echo "[restore] basic integrity checks"
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f scripts/verify-restore.sql

echo "[restore] complete"
