BEGIN;

ALTER TABLE users
  ADD COLUMN password_hash text,
  ADD COLUMN password_changed_at timestamptz;

CREATE TABLE refresh_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  user_agent text,
  ip inet,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  rotated_from uuid REFERENCES refresh_sessions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_sessions_user
  ON refresh_sessions (tenant_id, user_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE refresh_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_refresh_sessions ON refresh_sessions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

COMMIT;
