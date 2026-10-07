BEGIN;

CREATE TABLE tenant_microsoft_integrations (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  entra_tenant_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  teams_webhook_ciphertext text,
  teams_webhook_iv text,
  teams_webhook_tag text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE microsoft_oidc_states (
  state_hash text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE microsoft_login_tickets (
  token_hash text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_microsoft_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_microsoft_integrations ON tenant_microsoft_integrations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE INDEX idx_microsoft_oidc_state_expiry ON microsoft_oidc_states (expires_at);
CREATE INDEX idx_microsoft_ticket_expiry ON microsoft_login_tickets (expires_at);

COMMIT;
