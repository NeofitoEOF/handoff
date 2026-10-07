BEGIN;

CREATE TABLE recurrence_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  recurrence_id uuid NOT NULL REFERENCES recurrences(id),
  scheduled_for timestamptz NOT NULL,
  campaign_id uuid REFERENCES campaigns(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, recurrence_id, scheduled_for)
);

ALTER TABLE recurrence_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_recurrence_runs ON recurrence_runs
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

COMMIT;
