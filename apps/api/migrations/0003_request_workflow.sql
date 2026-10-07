BEGIN;

CREATE TYPE request_item_status AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED');

CREATE TABLE request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL REFERENCES requests(id),
  item_key text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status request_item_status NOT NULL DEFAULT 'DRAFT',
  last_edited_by uuid REFERENCES users(id),
  submitted_by uuid REFERENCES users(id),
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  return_comment text,
  correction_due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, request_id, item_key)
);

CREATE TABLE request_due_date_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL REFERENCES requests(id),
  previous_due_at timestamptz NOT NULL,
  new_due_at timestamptz NOT NULL,
  changed_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE request_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL UNIQUE REFERENCES requests(id),
  cancelled_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  cancelled_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_request_items_request_status
  ON request_items (tenant_id, request_id, status);

ALTER TABLE request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_due_date_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_cancellations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_request_items ON request_items
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_request_due_date_history ON request_due_date_history
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_request_cancellations ON request_cancellations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

COMMIT;
