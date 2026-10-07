BEGIN;

CREATE TABLE tenant_compliance_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  retention_years integer NOT NULL DEFAULT 5
    CHECK (retention_years BETWEEN 1 AND 20),
  default_legal_basis text,
  auto_purge_enabled boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE data_subject_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subject_user_id uuid NOT NULL REFERENCES users(id),
  request_type text NOT NULL
    CHECK (request_type IN ('ACCESS','CORRECTION','ERASURE','RESTRICTION')),
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','IN_REVIEW','COMPLETED','REJECTED')),
  reason text,
  resolution text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX idx_data_subject_requests_tenant_status
  ON data_subject_requests (tenant_id, status, created_at DESC);

ALTER TABLE tenant_compliance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_compliance_settings ON tenant_compliance_settings
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_data_subject_requests ON data_subject_requests
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO tenant_compliance_settings (tenant_id)
SELECT id FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

COMMIT;
