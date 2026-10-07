import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const enabled = Boolean(process.env.MIGRATION_DATABASE_URL && process.env.DATABASE_URL);
const suite = enabled ? describe : describe.skip;

suite("billing sector quota concurrency", () => {
  let admin: pg.Client;
  let tenantId: string;
  let actorUserId: string;
  let createSector: typeof import("./modules/sectors/sector.service.js").createSector;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= "test-jwt-secret-".padEnd(40, "x");
    process.env.OBJECT_STORAGE_ACCESS_KEY ??= "test-access";
    process.env.OBJECT_STORAGE_SECRET_KEY ??= "test-secret";
    process.env.MFA_ENCRYPTION_KEY ??= "11".repeat(32);
    process.env.PLATFORM_ADMIN_KEY ??= "test-platform-admin-key".padEnd(40, "x");
    process.env.INTEGRATION_ENCRYPTION_KEY ??= "22".repeat(32);
    process.env.CLAMAV_ENABLED = "false";
    process.env.NODE_ENV = "test";
    ({ createSector } = await import("./modules/sectors/sector.service.js"));
    admin = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await admin.connect();
    tenantId = (await admin.query<{ id: string }>(
      `INSERT INTO tenants (name, subdomain) VALUES ('Quota test', 'quota-' || gen_random_uuid()::text) RETURNING id`,
    )).rows[0]!.id;
    actorUserId = (await admin.query<{ id: string }>(
      `INSERT INTO users (email, name) VALUES ('quota-' || gen_random_uuid()::text || '@example.test', 'Quota admin') RETURNING id`,
    )).rows[0]!.id;
    await admin.query(`INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, $2, 'ADMIN')`, [tenantId, actorUserId]);
    await admin.query(`INSERT INTO sectors (tenant_id, name) VALUES ($1, 'Existing')`, [tenantId]);
  });

  afterAll(async () => { if (admin) await admin.end(); });

  it("allows only one concurrent creation into the final Starter slot without a billing profile", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, (_, index) =>
      createSector({ tenantId, actorUserId, name: `Concurrent ${index}` }),
    ));
    expect(results.filter(result => result.kind === "created")).toHaveLength(1);
    expect(results.filter(result => result.kind === "plan_limit")).toHaveLength(3);
    const count = await admin.query<{ count: string }>(`SELECT count(*)::text FROM sectors WHERE tenant_id = $1 AND active`, [tenantId]);
    expect(count.rows[0]!.count).toBe("2");
    const audit = await admin.query<{ count: string }>(`SELECT count(*)::text FROM audit_events WHERE tenant_id = $1 AND action = 'SECTOR_CREATED'`, [tenantId]);
    expect(audit.rows[0]!.count).toBe("1");
  });
});
