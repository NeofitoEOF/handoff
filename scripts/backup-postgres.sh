#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

OUTPUT="${1:-handoff-$(date -u +%Y%m%dT%H%M%SZ).dump}"

echo "[backup] writing ${OUTPUT}"
pg_dump --dbname="${DATABASE_URL}"   --format=custom   --no-owner   --no-privileges   --file="${OUTPUT}"

echo "[backup] verifying archive"
pg_restore --list "${OUTPUT}" >/dev/null

echo "[backup] done: ${OUTPUT}"
