import { config } from "./config.js";
import { withTenantTransaction, type DbClient } from "./db.js";

export async function consumeTenantRateLimit(client: DbClient, tenantId: string, max = config.TENANT_RATE_LIMIT_PER_MINUTE) {
  // Atomic upsert shares the budget across users, credentials and API replicas.
  // Capping at max + 1 prevents an overflowing counter under sustained rejection.
  const result = await client.query<{ allowed: boolean; retry_after: number }>(
    `INSERT INTO tenant_rate_limits (tenant_id, window_start, request_count)
     VALUES ($1, date_trunc('minute', statement_timestamp()), 1)
     ON CONFLICT (tenant_id) DO UPDATE SET
       window_start = EXCLUDED.window_start,
       request_count = CASE
         WHEN tenant_rate_limits.window_start <> EXCLUDED.window_start THEN 1
         ELSE LEAST(tenant_rate_limits.request_count, $2) + 1
       END
     RETURNING request_count <= $2 AS allowed,
       GREATEST(1, ceil(extract(epoch FROM
         (window_start + interval '1 minute' - statement_timestamp()))))::integer AS retry_after`,
    [tenantId, max],
  );
  return result.rows[0]!;
}

export async function enforceTenantRateLimit(tenantId: string): Promise<void> {
  const result = await withTenantTransaction(tenantId, client => consumeTenantRateLimit(client, tenantId));
  if (!result.allowed) {
    throw Object.assign(new Error("Limite de requisições da empresa atingido."), {
      statusCode: 429,
      retryAfter: result.retry_after,
    });
  }
}
