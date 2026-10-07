BEGIN;

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  origin_sector_id uuid NOT NULL REFERENCES sectors(id),
  template_version_id uuid REFERENCES template_versions(id),
  title text NOT NULL,
  competence text,
  due_at timestamptz NOT NULL,
  instructions text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign_requests (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  request_id uuid NOT NULL REFERENCES requests(id),
  destination_sector_id uuid NOT NULL REFERENCES sectors(id),
  PRIMARY KEY (campaign_id, request_id),
  UNIQUE (campaign_id, destination_sector_id)
);

CREATE TABLE recurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  origin_sector_id uuid NOT NULL REFERENCES sectors(id),
  template_version_id uuid REFERENCES template_versions(id),
  destination_sector_ids uuid[] NOT NULL,
  title text NOT NULL,
  instructions text,
  frequency text NOT NULL CHECK (frequency IN ('WEEKLY', 'MONTHLY')),
  next_run_at timestamptz NOT NULL,
  due_offset_days integer NOT NULL DEFAULT 5 CHECK (due_offset_days BETWEEN 0 AND 90),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurrences ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_campaigns ON campaigns
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_campaign_requests ON campaign_requests
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_recurrences ON recurrences
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

COMMIT;
