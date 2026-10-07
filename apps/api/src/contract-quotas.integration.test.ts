import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const enabled = Boolean(process.env.MIGRATION_DATABASE_URL && process.env.DATABASE_URL);
const suite = enabled ? describe : describe.skip;

suite("contract quotas", () => {
  let admin: pg.Client;
  let tenantId: string;
  let actorUserId: string;
  let origin: string;
  let destination: string;
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
    ({ withTenantTransaction: transaction } = await import("./db.js"));
    admin = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await admin.connect();
    tenantId = (await admin.query<{ id: string }>(
      `INSERT INTO tenants (name, subdomain) VALUES ('Quota test', 'quota-' || gen_random_uuid()::text) RETURNING id`,
    )).rows[0]!.id;
    actorUserId = (await admin.query<{ id: string }>(
      `INSERT INTO users (email, name) VALUES ('quota-' || gen_random_uuid()::text || '@example.test', 'Quota admin') RETURNING id`,
    )).rows[0]!.id;
    await admin.query(`INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, $2, 'ADMIN')`, [tenantId, actorUserId]);
    const sectors = await admin.query<{ id: string }>(`INSERT INTO sectors (tenant_id, name) VALUES ($1, 'Origin'), ($1, 'Destination') RETURNING id`, [tenantId]);
    origin = sectors.rows[0]!.id;
    destination = sectors.rows[1]!.id;
    await admin.query(`INSERT INTO billing_profiles (tenant_id, monthly_request_limit) VALUES ($1, 1)`, [tenantId]);
  });

  afterAll(async () => { if (admin) await admin.end(); });


  const insert = (client: pg.PoolClient) => client.query<{ id: string }>(
    `INSERT INTO requests (tenant_id, origin_sector_id, destination_sector_id, created_by, title, due_at, status)
     VALUES ($1,$2,$3,$4,'Quota request',now() + interval '1 day','OPEN') RETURNING id`,
    [tenantId, origin, destination, actorUserId],
  );

  it("allows only one concurrent request at a quota of one", async () => {
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => transaction(tenantId, insert)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failures = results.filter(result => result.status === 'rejected');
    expect(failures).toHaveLength(3);
    for (const failure of failures) {
      if (failure.status === 'rejected') expect(failure.reason).toMatchObject({ code: 'P0001', message: 'monthly_request_limit' });
    }
  });

  it("does not charge an idempotent ON CONFLICT retry", async () => {
    const existing = await admin.query<{ id: string }>(`SELECT id FROM requests WHERE tenant_id = $1`, [tenantId]);
    await expect(transaction(tenantId, client => client.query(
      `INSERT INTO requests (id, tenant_id, origin_sector_id, destination_sector_id, created_by, title, due_at, status)
       VALUES ($1,$2,$3,$4,$5,'Retry',now(),'OPEN') ON CONFLICT DO NOTHING`,
      [existing.rows[0]!.id, tenantId, origin, destination, actorUserId],
    ))).resolves.toMatchObject({ rowCount: 0 });
  });

  it("rolls back the entire batch if a later request exceeds the limit", async () => {
    await admin.query(`UPDATE billing_profiles SET monthly_request_limit = 2 WHERE tenant_id = $1`, [tenantId]);
    await expect(transaction(tenantId, async client => { await insert(client); await insert(client); })).rejects.toMatchObject({ message: 'monthly_request_limit' });
    const count = await admin.query<{ count: string }>(`SELECT count(*)::text FROM requests WHERE tenant_id = $1`, [tenantId]);
    expect(count.rows[0]!.count).toBe('1');
  });

  it("blocks suspended billing even with unlimited monthly requests", async () => {
    await admin.query(`UPDATE billing_profiles SET monthly_request_limit = NULL, status = 'SUSPENDED' WHERE tenant_id = $1`, [tenantId]);
    await expect(transaction(tenantId, insert)).rejects.toMatchObject({ message: 'billing_inactive' });
  });

  it("updates quotas under RLS and preserves omitted contractual limits", async () => {
    const { updateBillingProfile, getBillingSummary } = await import("./modules/billing/billing.service.js");
    const input = {
      platformAdminKey: process.env.PLATFORM_ADMIN_KEY,
      tenantId, plan: 'ENTERPRISE' as const, status: 'ACTIVE' as const,
      monthlyPricePerSectorCents: 0, currency: 'BRL',
    };
    expect((await updateBillingProfile({ ...input, monthlyRequestLimit: 10, storageLimitBytes: 100 })).kind).toBe('updated');
    expect((await updateBillingProfile(input)).kind).toBe('updated');
    const summary = await getBillingSummary({ tenantId, actorUserId });
    expect(summary.kind).toBe('ok');
    if (summary.kind === 'ok') expect(summary.summary.entitlements).toMatchObject({ monthlyRequests: 10, storageBytes: 100 });
    await updateBillingProfile({ ...input, monthlyRequestLimit: null, storageLimitBytes: null });
    const reset = await getBillingSummary({ tenantId, actorUserId });
    if (reset.kind === 'ok') expect(reset.summary.entitlements).toMatchObject({ monthlyRequests: null, storageBytes: null });
  });

});
