\set ON_ERROR_STOP on

DO $$
DECLARE
  missing text[];
BEGIN
  SELECT array_agg(required_table)
    INTO missing
    FROM (
      SELECT unnest(ARRAY[
        'tenants',
        'users',
        'sectors',
        'memberships',
        'requests',
        'request_items',
        'audit_events',
        'snapshots'
      ]) AS required_table
    ) expected
   WHERE to_regclass('public.' || required_table) IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'restore verification failed; missing tables: %', missing;
  END IF;
END;
$$;

SELECT count(*) AS migration_count FROM schema_migrations;
SELECT count(*) AS tenant_count FROM tenants;
SELECT count(*) AS audit_event_count FROM audit_events;


DO $$
DECLARE
  missing_checksum_count bigint;
BEGIN
  SELECT count(*)
    INTO missing_checksum_count
    FROM schema_migrations
   WHERE checksum IS NULL
      OR checksum !~ '^[a-f0-9]{64}$';

  IF missing_checksum_count > 0 THEN
    RAISE EXCEPTION
      'restore verification failed; % migration(s) have missing/invalid checksum',
      missing_checksum_count;
  END IF;
END;
$$;

SELECT count(*) FILTER (WHERE checksum IS NULL) AS migration_checksum_missing_count
FROM schema_migrations;
