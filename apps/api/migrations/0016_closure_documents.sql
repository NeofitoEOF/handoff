BEGIN;

CREATE TABLE closure_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL UNIQUE REFERENCES requests(id),
  snapshot_id uuid NOT NULL UNIQUE REFERENCES snapshots(id),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'READY', 'FAILED')),
  pdf_storage_key text,
  pdf_sha256 text,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  generated_at timestamptz
);

CREATE INDEX idx_closure_documents_pending
  ON closure_documents (tenant_id, status, available_at)
  WHERE status IN ('PENDING', 'FAILED');

ALTER TABLE closure_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_closure_documents ON closure_documents
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

COMMIT;
