BEGIN;

CREATE TABLE public_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  token_prefix text NOT NULL,
  token_hash text NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['requests:read']::text[],
  created_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, token_hash)
);

CREATE TABLE webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  url text NOT NULL,
  events text[] NOT NULL,
  secret_ciphertext text NOT NULL,
  secret_iv text NOT NULL,
  secret_tag text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  webhook_id uuid NOT NULL REFERENCES webhooks(id),
  event_type text NOT NULL,
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  payload jsonb NOT NULL,
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, webhook_id, dedupe_key)
);

CREATE INDEX idx_public_api_keys_lookup
  ON public_api_keys (tenant_id, token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_webhooks_tenant_active
  ON webhooks (tenant_id, active);

CREATE INDEX idx_webhook_outbox_pending
  ON webhook_outbox (tenant_id, status, available_at);

ALTER TABLE public_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_public_api_keys ON public_api_keys
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_webhooks ON webhooks
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_webhook_outbox ON webhook_outbox
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

COMMIT;
