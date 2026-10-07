BEGIN;

CREATE INDEX IF NOT EXISTS idx_memberships_user_sector_active
  ON memberships (tenant_id, user_id, sector_id, role)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_requests_tenant_due_active
  ON requests (tenant_id, due_at, status)
  WHERE status NOT IN ('CLOSED', 'CANCELLED');

CREATE INDEX IF NOT EXISTS idx_requests_tenant_assigned_due
  ON requests (tenant_id, assigned_to, due_at)
  WHERE assigned_to IS NOT NULL
    AND status NOT IN ('CLOSED', 'CANCELLED');

CREATE INDEX IF NOT EXISTS idx_requests_tenant_destination_due
  ON requests (tenant_id, destination_sector_id, due_at, status);

CREATE INDEX IF NOT EXISTS idx_requests_tenant_origin_review
  ON requests (tenant_id, origin_sector_id, status, due_at)
  WHERE status = 'IN_REVIEW';

CREATE INDEX IF NOT EXISTS idx_request_items_request_status
  ON request_items (tenant_id, request_id, status, created_at);

COMMIT;
