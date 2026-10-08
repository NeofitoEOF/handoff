BEGIN;

CREATE TABLE request_item_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_item_id uuid NOT NULL REFERENCES request_items(id),
  approved_by uuid NOT NULL REFERENCES users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, request_item_id, approved_by)
);

CREATE INDEX idx_request_item_approvals_item
  ON request_item_approvals (tenant_id, request_item_id);

ALTER TABLE request_item_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_request_item_approvals ON request_item_approvals
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

COMMIT;
