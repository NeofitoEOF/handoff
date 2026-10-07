BEGIN;

ALTER TABLE requests
  ADD COLUMN retifies_request_id uuid REFERENCES requests(id);

CREATE TABLE snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL UNIQUE REFERENCES requests(id),
  content jsonb NOT NULL,
  sha256 text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION prevent_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'snapshot is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_snapshot_immutable
BEFORE UPDATE OR DELETE ON snapshots
FOR EACH ROW
EXECUTE FUNCTION prevent_snapshot_mutation();

ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_snapshots ON snapshots
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE UNIQUE INDEX uq_single_active_retification
  ON requests (tenant_id, retifies_request_id)
  WHERE retifies_request_id IS NOT NULL
    AND status NOT IN ('CLOSED', 'CANCELLED');

COMMIT;
