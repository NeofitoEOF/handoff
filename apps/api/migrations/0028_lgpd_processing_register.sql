BEGIN;

ALTER TABLE tenant_compliance_settings
  ADD COLUMN dpa_status text NOT NULL DEFAULT 'NOT_CONFIGURED'
    CHECK (dpa_status IN ('NOT_CONFIGURED','DRAFT','SIGNED')),
  ADD COLUMN dpa_reference text,
  ADD COLUMN dpa_signed_at timestamptz;

CREATE TABLE data_processing_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  purpose text NOT NULL,
  legal_basis text NOT NULL,
  data_categories text[] NOT NULL DEFAULT '{}'::text[],
  subject_categories text[] NOT NULL DEFAULT '{}'::text[],
  processors text[] NOT NULL DEFAULT '{}'::text[],
  retention_years integer
    CHECK (retention_years IS NULL OR retention_years BETWEEN 1 AND 20),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_processing_activities_tenant_active
  ON data_processing_activities (tenant_id, active, name);

ALTER TABLE data_processing_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_processing_activities ON data_processing_activities
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

COMMIT;
