BEGIN;

CREATE TABLE audit_anchors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  anchor_date date NOT NULL,
  chain_seq bigint NOT NULL,
  chain_hash text NOT NULL CHECK (chain_hash ~ '^[a-f0-9]{64}$'),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  storage_bucket text NOT NULL,
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, anchor_date),
  UNIQUE (tenant_id, storage_key)
);

CREATE INDEX idx_audit_anchors_tenant_date
  ON audit_anchors (tenant_id, anchor_date DESC);

ALTER TABLE audit_anchors ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_audit_anchors ON audit_anchors
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION prevent_audit_anchor_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_anchors is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_anchors_append_only
BEFORE UPDATE OR DELETE ON audit_anchors
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_anchor_mutation();

COMMIT;
