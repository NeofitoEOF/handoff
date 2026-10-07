BEGIN;

ALTER TABLE billing_profiles
  ADD COLUMN monthly_request_limit integer CHECK (monthly_request_limit >= 0),
  ADD COLUMN storage_limit_bytes bigint CHECK (storage_limit_bytes >= 0 AND storage_limit_bytes <= 9007199254740991);

-- AFTER INSERT excludes ON CONFLICT DO NOTHING rows. All creation paths,
-- including campaigns, corrections and workers, use the same quota guard.
CREATE FUNCTION enforce_request_contract_quota() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  quota integer;
  billing_status text;
  used bigint;
  month_start timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('request-quota:' || NEW.tenant_id::text));
  SELECT monthly_request_limit, status INTO quota, billing_status
    FROM billing_profiles WHERE tenant_id = NEW.tenant_id;
  IF billing_status IN ('SUSPENDED', 'CANCELLED') THEN
    RAISE EXCEPTION 'billing_inactive' USING ERRCODE = 'P0001';
  END IF;
  IF quota IS NOT NULL THEN
    month_start := date_trunc('month', transaction_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    SELECT count(*) INTO used FROM requests
      WHERE tenant_id = NEW.tenant_id AND created_at >= month_start
        AND created_at < ((month_start AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC';
    IF used > quota THEN
      RAISE EXCEPTION 'monthly_request_limit' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER requests_contract_quota AFTER INSERT ON requests
  FOR EACH ROW EXECUTE FUNCTION enforce_request_contract_quota();

CREATE INDEX requests_tenant_created_at_idx ON requests (tenant_id, created_at);
COMMIT;
