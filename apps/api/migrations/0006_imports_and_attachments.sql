BEGIN;

CREATE TABLE imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL REFERENCES requests(id),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  filename text NOT NULL,
  storage_key text NOT NULL,
  sha256 text NOT NULL,
  status text NOT NULL CHECK (status IN ('PROCESSING', 'VALIDATED', 'CONFIRMED', 'FAILED')),
  staged_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_rows integer NOT NULL DEFAULT 0,
  accepted_rows integer NOT NULL DEFAULT 0,
  rejected_rows integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL REFERENCES requests(id),
  item_id uuid REFERENCES request_items(id),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  storage_key text NOT NULL,
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('QUARANTINED', 'AVAILABLE', 'REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_imports_request ON imports (tenant_id, request_id, created_at DESC);
CREATE INDEX idx_attachments_request ON attachments (tenant_id, request_id, item_id);

ALTER TABLE imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_imports ON imports
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_attachments ON attachments
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

COMMIT;
