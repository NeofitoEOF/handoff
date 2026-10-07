import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const enabled = Boolean(process.env.MIGRATION_DATABASE_URL && process.env.DATABASE_URL);
const suite = enabled ? describe : describe.skip;

suite("shared tenant rate limit", () => {
  let admin: pg.Client;
  let tenantId: string;

  let consume: typeof import("./tenant-rate-limit.js").consumeTenantRateLimit;
  let transaction: typeof import("./db.js").withTenantTransaction;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= "test-jwt-secret-".padEnd(40, "x");
    process.env.OBJECT_STORAGE_ACCESS_KEY ??= "test-access";
    process.env.OBJECT_STORAGE_SECRET_KEY ??= "test-secret";
    process.env.MFA_ENCRYPTION_KEY ??= "11".repeat(32);
    process.env.PLATFORM_ADMIN_KEY ??= "test-platform-admin-key".padEnd(40, "x");
    process.env.INTEGRATION_ENCRYPTION_KEY ??= "22".repeat(32);
    process.env.CLAMAV_ENABLED = "false";
    process.env.NODE_ENV = "test";
    ({ consumeTenantRateLimit: consume } = await import("./tenant-rate-limit.js"));
    ({ withTenantTransaction: transaction } = await import("./db.js"));
    admin = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await admin.connect();
    tenantId = (await admin.query<{ id: string }>(
      `INSERT INTO tenants (name, subdomain) VALUES ('Quota test', 'quota-' || gen_random_uuid()::text) RETURNING id`,
    )).rows[0]!.id;

  });

  afterAll(async () => { if (admin) await admin.end(); });

  it("shares one atomic budget across concurrent clients and resets an expired window", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      transaction(tenantId, client => consume(client, tenantId, 3)),
    ));
    expect(results.filter(result => result.allowed)).toHaveLength(3);
    expect(results.filter(result => !result.allowed)).toHaveLength(5);
    for (const result of results) expect(result.retry_after).toBeGreaterThanOrEqual(1);
    const row = await admin.query<{ request_count: number }>(`SELECT request_count FROM tenant_rate_limits WHERE tenant_id = $1`, [tenantId]);
    expect(row.rows[0]!.request_count).toBe(4);
    await admin.query(`UPDATE tenant_rate_limits SET window_start = now() - interval '2 minutes' WHERE tenant_id = $1`, [tenantId]);
    expect((await transaction(tenantId, client => consume(client, tenantId, 3))).allowed).toBe(true);
  });

  it("isolates the budget of another tenant under RLS", async () => {
    const otherTenant = (await admin.query<{ id: string }>(
      `INSERT INTO tenants (name, subdomain) VALUES ('Other quota', 'other-quota-' || gen_random_uuid()::text) RETURNING id`,
    )).rows[0]!.id;
    expect((await transaction(otherTenant, client => consume(client, otherTenant, 3))).allowed).toBe(true);
    const rows = await transaction(otherTenant, client => client.query(`SELECT tenant_id FROM tenant_rate_limits`));
    expect(rows.rows).toEqual([{ tenant_id: otherTenant }]);
  });
});
