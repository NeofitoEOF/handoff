BEGIN;

CREATE TABLE login_failures (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, email_hash)
);

CREATE INDEX idx_login_failures_locked
  ON login_failures (locked_until)
  WHERE locked_until IS NOT NULL;

COMMIT;
