BEGIN;

-- Reset tokens are short-lived and did not previously carry tenant context.
-- Invalidate any pre-migration tokens instead of guessing a tenant for users
-- that may belong to more than one tenant.
DELETE FROM password_reset_tokens;

ALTER TABLE password_reset_tokens
  ADD COLUMN tenant_id uuid NOT NULL REFERENCES tenants(id);

CREATE INDEX idx_password_reset_tenant_user
  ON password_reset_tokens (tenant_id, user_id, expires_at)
  WHERE used_at IS NULL;

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_password_reset_tokens ON password_reset_tokens
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

COMMIT;
