BEGIN;

ALTER TABLE audit_events
  ADD COLUMN chain_seq bigint,
  ADD COLUMN prev_hash text,
  ADD COLUMN hash text;

-- Backfill existing events tenant by tenant. The append-only guard is temporarily
-- disabled only inside this migration transaction.
ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_append_only;

DO $$
DECLARE
  tenant_row record;
  event_row record;
  last_hash text;
  next_seq bigint;
  canonical_payload text;
  calculated_hash text;
BEGIN
  FOR tenant_row IN
    SELECT DISTINCT tenant_id FROM audit_events ORDER BY tenant_id
  LOOP
    last_hash := NULL;
    next_seq := 1;

    FOR event_row IN
      SELECT *
        FROM audit_events
       WHERE tenant_id = tenant_row.tenant_id
       ORDER BY created_at, id
    LOOP
      canonical_payload := jsonb_build_object(
        'tenant_id', event_row.tenant_id,
        'actor_user_id', event_row.actor_user_id,
        'action', event_row.action,
        'entity_type', event_row.entity_type,
        'entity_id', event_row.entity_id,
        'before_data', event_row.before_data,
        'after_data', event_row.after_data,
        'created_at', event_row.created_at,
        'chain_seq', next_seq,
        'prev_hash', last_hash
      )::text;

      calculated_hash := encode(
        digest(convert_to(canonical_payload, 'UTF8'), 'sha256'),
        'hex'
      );

      UPDATE audit_events
         SET chain_seq = next_seq,
             prev_hash = last_hash,
             hash = calculated_hash
       WHERE id = event_row.id;

      last_hash := calculated_hash;
      next_seq := next_seq + 1;
    END LOOP;
  END LOOP;
END;
$$;

ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_append_only;

CREATE OR REPLACE FUNCTION audit_events_hash_chain()
RETURNS trigger AS $$
DECLARE
  previous_seq bigint;
  previous_hash text;
  canonical_payload text;
BEGIN
  -- Serialize inserts per tenant so two concurrent events cannot receive the
  -- same predecessor.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text, 0));

  SELECT chain_seq, hash
    INTO previous_seq, previous_hash
    FROM audit_events
   WHERE tenant_id = NEW.tenant_id
     AND chain_seq IS NOT NULL
   ORDER BY chain_seq DESC
   LIMIT 1;

  NEW.chain_seq := COALESCE(previous_seq, 0) + 1;
  NEW.prev_hash := previous_hash;

  canonical_payload := jsonb_build_object(
    'tenant_id', NEW.tenant_id,
    'actor_user_id', NEW.actor_user_id,
    'action', NEW.action,
    'entity_type', NEW.entity_type,
    'entity_id', NEW.entity_id,
    'before_data', NEW.before_data,
    'after_data', NEW.after_data,
    'created_at', NEW.created_at,
    'chain_seq', NEW.chain_seq,
    'prev_hash', NEW.prev_hash
  )::text;

  NEW.hash := encode(
    digest(convert_to(canonical_payload, 'UTF8'), 'sha256'),
    'hex'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_events_hash_chain
BEFORE INSERT ON audit_events
FOR EACH ROW
EXECUTE FUNCTION audit_events_hash_chain();

ALTER TABLE audit_events
  ALTER COLUMN chain_seq SET NOT NULL,
  ALTER COLUMN hash SET NOT NULL;

CREATE UNIQUE INDEX uq_audit_events_tenant_chain_seq
  ON audit_events (tenant_id, chain_seq);

CREATE INDEX idx_audit_events_tenant_hash
  ON audit_events (tenant_id, hash);

COMMIT;
