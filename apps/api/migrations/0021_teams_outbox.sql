BEGIN;

CREATE TABLE teams_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid REFERENCES requests(id),
  title text NOT NULL,
  message text NOT NULL,
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dedupe_key)
);

CREATE INDEX idx_teams_outbox_pending
  ON teams_outbox (tenant_id, status, available_at)
  WHERE status IN ('PENDING', 'FAILED');

ALTER TABLE teams_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_teams_outbox ON teams_outbox
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

COMMIT;
