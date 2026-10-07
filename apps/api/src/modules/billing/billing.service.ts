import { config } from "../../config.js";
import { pool, withTenantTransaction } from "../../db.js";
import { isTenantAdmin } from "../../authorization.js";

export type BillingPlan = "STARTER" | "BUSINESS" | "ENTERPRISE";
export type BillingStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED";

export const PLAN_ENTITLEMENTS: Record<
  BillingPlan,
  {
    maxSectors: number | null;
    storageBytes: number | null;
  }
> = {
  STARTER: {
    maxSectors: 2,
    storageBytes: 10 * 1024 ** 3,
  },
  BUSINESS: {
    maxSectors: 10,
    storageBytes: 100 * 1024 ** 3,
  },
  ENTERPRISE: {
    maxSectors: null,
    storageBytes: null,
  },
};

export async function getTenantPlan(
  client: import("../../db.js").DbClient,
  tenantId: string,
) {
  const result = await client.query<{
    plan: BillingPlan;
    status: BillingStatus;
    monthly_price_per_sector_cents: number;
    currency: string;
    monthly_request_limit: number | null;
    storage_limit_bytes: string | null;
  }>(
    `SELECT plan, status, monthly_price_per_sector_cents, currency, monthly_request_limit, storage_limit_bytes
       FROM billing_profiles
      WHERE tenant_id = $1
      LIMIT 1`,
    [tenantId],
  );

  return (
    result.rows[0] ?? {
      plan: "STARTER" as const,
      status: "TRIAL" as const,
      monthly_price_per_sector_cents: 0,
      currency: "BRL",
      monthly_request_limit: null,
      storage_limit_bytes: null,
    }
  );
}

export function effectiveEntitlements(profile: {
  plan: BillingPlan;
  monthly_request_limit: number | null;
  storage_limit_bytes: string | null;
}) {
  return {
    ...PLAN_ENTITLEMENTS[profile.plan],
    monthlyRequests: profile.monthly_request_limit,
    storageBytes: profile.storage_limit_bytes == null
      ? PLAN_ENTITLEMENTS[profile.plan].storageBytes
      : Number(profile.storage_limit_bytes),
  };
}

export async function canEnableAnotherSector(
  client: import("../../db.js").DbClient,
  tenantId: string,
) {
  // Hold through the sector INSERT/COMMIT so concurrent requests cannot
  // both consume the last available slot (including profiles not yet created).
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `sector-quota:${tenantId}`,
  ]);

  const profile = await getTenantPlan(client, tenantId);
  if (["SUSPENDED", "CANCELLED"].includes(profile.status)) {
    return {
      allowed: false as const,
      reason: "billing_inactive" as const,
      profile,
    };
  }

  const entitlement = PLAN_ENTITLEMENTS[profile.plan];
  if (entitlement.maxSectors === null) {
    return { allowed: true as const, profile };
  }

  const count = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM sectors
      WHERE tenant_id = $1 AND active = true`,
    [tenantId],
  );
  const activeSectors = Number(count.rows[0]?.count ?? 0);

  return activeSectors >= entitlement.maxSectors
    ? {
        allowed: false as const,
        reason: "sector_limit" as const,
        activeSectors,
        limit: entitlement.maxSectors,
        profile,
      }
    : { allowed: true as const, profile, activeSectors };
}

export async function checkTenantStorageCapacity(
  client: import("../../db.js").DbClient,
  tenantId: string,
  incomingBytes: number,
) {
  if (!Number.isSafeInteger(incomingBytes) || incomingBytes < 0) {
    throw new RangeError("incomingBytes must be a non-negative safe integer");
  }

  const profile = await getTenantPlan(client, tenantId);
  if (["SUSPENDED", "CANCELLED"].includes(profile.status)) {
    return {
      allowed: false as const,
      reason: "billing_inactive" as const,
      profile,
    };
  }

  const entitlement = effectiveEntitlements(profile);
  if (entitlement.storageBytes === null) {
    return { allowed: true as const, profile, usedBytes: 0, limitBytes: null };
  }

  // Serializa apenas decisões de quota do mesmo tenant durante esta transação.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `storage-quota:${tenantId}`,
  ]);

  const usage = await client.query<{ bytes: string }>(
    `SELECT
        COALESCE((SELECT sum(size_bytes) FROM attachments WHERE tenant_id = $1), 0) +
        COALESCE((SELECT sum(size_bytes) FROM imports WHERE tenant_id = $1), 0) AS bytes`,
    [tenantId],
  );
  const usedBytes = Number(usage.rows[0]?.bytes ?? 0);
  const limitBytes = entitlement.storageBytes;

  if (usedBytes + incomingBytes > limitBytes) {
    return {
      allowed: false as const,
      reason: "storage_limit" as const,
      profile,
      usedBytes,
      incomingBytes,
      limitBytes,
    };
  }

  return {
    allowed: true as const,
    profile,
    usedBytes,
    incomingBytes,
    limitBytes,
  };
}

export async function getBillingSummary(input: {
  tenantId: string;
  actorUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await isTenantAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const profile = await getTenantPlan(client, input.tenantId);
    const entitlement = effectiveEntitlements(profile);

    const sectorCount = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM sectors WHERE active = true`,
    );
    const requestCount = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM requests
        WHERE created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,
    );
    const storage = await client.query<{ bytes: string }>(
      `SELECT
          COALESCE((SELECT sum(size_bytes) FROM attachments WHERE tenant_id = $1), 0) +
          COALESCE((SELECT sum(size_bytes) FROM imports WHERE tenant_id = $1), 0) AS bytes`,
      [input.tenantId],
    );

    const enabledSectors = Number(sectorCount.rows[0]?.count ?? 0);
    const requestsThisMonth = Number(requestCount.rows[0]?.count ?? 0);
    const storageBytes = Number(storage.rows[0]?.bytes ?? 0);
    const billableAmountCents =
      enabledSectors * profile.monthly_price_per_sector_cents;

    return {
      kind: "ok" as const,
      summary: {
        profile,
        entitlements: entitlement,
        usage: {
          enabledSectors,
          requestsThisMonth,
          storageBytes,
        },
        estimatedMonthlyAmountCents: billableAmountCents,
      },
    };
  });
}

export async function updateBillingProfile(input: {
  platformAdminKey: string | undefined;
  tenantId: string;
  plan: BillingPlan;
  status: BillingStatus;
  monthlyPricePerSectorCents: number;
  currency: string;
  provider?: string | null;
  externalCustomerId?: string | null;
  externalSubscriptionId?: string | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  monthlyRequestLimit?: number | null;
  storageLimitBytes?: number | null;
}) {
  if (!input.platformAdminKey || input.platformAdminKey !== config.PLATFORM_ADMIN_KEY) {
    return { kind: "forbidden" as const };
  }

  const tenant = await pool.query(
    `SELECT 1 FROM tenants WHERE id = $1 LIMIT 1`,
    [input.tenantId],
  );
  if (tenant.rowCount !== 1) return { kind: "tenant_not_found" as const };

  return withTenantTransaction(input.tenantId, async (client) => {
    const result = await client.query(
      `INSERT INTO billing_profiles
        (tenant_id, plan, status, monthly_price_per_sector_cents, currency,
         provider, external_customer_id, external_subscription_id,
         current_period_start, current_period_end, monthly_request_limit, storage_limit_bytes, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
       ON CONFLICT (tenant_id)
       DO UPDATE SET
         plan = EXCLUDED.plan,
         status = EXCLUDED.status,
         monthly_price_per_sector_cents = EXCLUDED.monthly_price_per_sector_cents,
         currency = EXCLUDED.currency,
         provider = EXCLUDED.provider,
         external_customer_id = EXCLUDED.external_customer_id,
         external_subscription_id = EXCLUDED.external_subscription_id,
         current_period_start = EXCLUDED.current_period_start,
         current_period_end = EXCLUDED.current_period_end,
         monthly_request_limit = CASE WHEN $13 THEN EXCLUDED.monthly_request_limit ELSE billing_profiles.monthly_request_limit END,
         storage_limit_bytes = CASE WHEN $14 THEN EXCLUDED.storage_limit_bytes ELSE billing_profiles.storage_limit_bytes END,
         updated_at = now()
       RETURNING tenant_id, plan, status, monthly_price_per_sector_cents, currency,
                 provider, current_period_start, current_period_end, monthly_request_limit, storage_limit_bytes`,
      [
        input.tenantId,
        input.plan,
        input.status,
        input.monthlyPricePerSectorCents,
        input.currency,
        input.provider ?? null,
        input.externalCustomerId ?? null,
        input.externalSubscriptionId ?? null,
        input.currentPeriodStart ?? null,
        input.currentPeriodEnd ?? null,
        input.monthlyRequestLimit ?? null,
        input.storageLimitBytes ?? null,
        input.monthlyRequestLimit !== undefined,
        input.storageLimitBytes !== undefined,
      ],
    );

    return { kind: "updated" as const, profile: result.rows[0] };
  });
}
