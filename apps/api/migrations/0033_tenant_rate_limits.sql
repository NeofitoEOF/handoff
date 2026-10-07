BEGIN;

-- One bounded row per tenant; expired windows are replaced on the next request.
CREATE TABLE tenant_rate_limits (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0)
);
ALTER TABLE tenant_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_rate_limits ON tenant_rate_limits
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

COMMIT;
