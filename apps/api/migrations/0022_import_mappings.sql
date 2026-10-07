BEGIN;

CREATE TABLE import_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  template_id uuid NOT NULL REFERENCES templates(id),
  name text NOT NULL DEFAULT 'Padrão',
  mapping_json jsonb NOT NULL,
  source_headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, template_id, name)
);

ALTER TABLE import_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_import_mappings ON import_mappings
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE INDEX idx_import_mappings_template
  ON import_mappings (tenant_id, template_id, active);

COMMIT;
