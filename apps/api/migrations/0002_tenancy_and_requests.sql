BEGIN;

CREATE TYPE tenant_role AS ENUM ('ADMIN', 'AUDITOR', 'USER');

CREATE TABLE tenant_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role tenant_role NOT NULL DEFAULT 'USER',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tenant_users ON tenant_users
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE requests
  ADD COLUMN competence text,
  ADD COLUMN instructions text;

CREATE UNIQUE INDEX uq_requests_model_sector_competence_placeholder
  ON requests (tenant_id, destination_sector_id, competence, title)
  WHERE competence IS NOT NULL
    AND status <> 'CANCELLED';

CREATE INDEX idx_tenant_users_user
  ON tenant_users (tenant_id, user_id)
  WHERE active = true;

COMMIT;
