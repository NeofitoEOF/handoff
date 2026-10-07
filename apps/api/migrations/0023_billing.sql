BEGIN;

CREATE TABLE billing_profiles (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  plan text NOT NULL DEFAULT 'STARTER'
    CHECK (plan IN ('STARTER', 'BUSINESS', 'ENTERPRISE')),
  monthly_price_per_sector_cents integer NOT NULL DEFAULT 0
    CHECK (monthly_price_per_sector_cents >= 0),
  currency char(3) NOT NULL DEFAULT 'BRL',
  status text NOT NULL DEFAULT 'TRIAL'
    CHECK (status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED')),
  provider text,
  external_customer_id text,
  external_subscription_id text,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE billing_usage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  enabled_sectors integer NOT NULL,
  requests_created integer NOT NULL,
  storage_bytes bigint NOT NULL DEFAULT 0,
  billable_amount_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_start, period_end)
);

ALTER TABLE billing_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_usage_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_billing_profiles ON billing_profiles
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_billing_usage ON billing_usage_snapshots
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO billing_profiles (tenant_id, plan, status)
SELECT id, 'STARTER', 'TRIAL'
  FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

COMMIT;
