BEGIN;

CREATE TABLE guest_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL REFERENCES requests(id),
  email text NOT NULL,
  link_token_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guest_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  guest_link_id uuid NOT NULL REFERENCES guest_links(id),
  otp_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guest_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  guest_link_id uuid NOT NULL REFERENCES guest_links(id),
  session_token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE request_items
  ADD COLUMN last_edited_guest_link_id uuid REFERENCES guest_links(id),
  ADD COLUMN submitted_guest_link_id uuid REFERENCES guest_links(id);

ALTER TABLE guest_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_guest_links ON guest_links
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_guest_otps ON guest_otps
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_guest_sessions ON guest_sessions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE INDEX idx_guest_links_request ON guest_links (tenant_id, request_id);
CREATE INDEX idx_guest_sessions_link ON guest_sessions (tenant_id, guest_link_id, expires_at);

COMMIT;
