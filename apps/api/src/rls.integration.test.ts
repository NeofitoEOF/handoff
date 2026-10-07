import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const { Client } = pg;

const adminUrl = process.env.MIGRATION_DATABASE_URL;
const appUrl = process.env.DATABASE_URL;

const enabled = Boolean(adminUrl && appUrl);
const suite = enabled ? describe : describe.skip;

suite("tenant RLS isolation", () => {
  let admin: pg.Client;
  let app: pg.Client;
  let tenantA = "";
  let tenantB = "";
  let sectorA = "";
  let sectorB = "";

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl! });
    app = new Client({ connectionString: appUrl! });
    await admin.connect();
    await app.connect();

    const tenants = await admin.query<{ id: string }>(
      `INSERT INTO tenants (name, subdomain)
       VALUES ('RLS A', 'rls-a-' || substr(gen_random_uuid()::text, 1, 8)),
              ('RLS B', 'rls-b-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
    );
    tenantA = tenants.rows[0]!.id;
    tenantB = tenants.rows[1]!.id;

    const sectors = await admin.query<{ id: string; tenant_id: string }>(
      `INSERT INTO sectors (tenant_id, name)
       VALUES ($1, 'Fiscal A'), ($2, 'Fiscal B')
       RETURNING id, tenant_id`,
      [tenantA, tenantB],
    );
    sectorA = sectors.rows.find((row) => row.tenant_id === tenantA)!.id;
    sectorB = sectors.rows.find((row) => row.tenant_id === tenantB)!.id;
  });

  afterAll(async () => {
    if (app) await app.end();
    if (admin) {
      await admin.query("DELETE FROM sectors WHERE id = ANY($1::uuid[])", [[sectorA, sectorB]]);
      await admin.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[tenantA, tenantB]]);
      await admin.end();
    }
  });

  it("only reads rows from the configured tenant", async () => {
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);

    const visible = await app.query<{ id: string }>("SELECT id FROM sectors ORDER BY id");
    expect(visible.rows.map((row) => row.id)).toContain(sectorA);
    expect(visible.rows.map((row) => row.id)).not.toContain(sectorB);

    const crossTenant = await app.query("SELECT id FROM sectors WHERE id = $1", [sectorB]);
    expect(crossTenant.rowCount).toBe(0);

    await app.query("ROLLBACK");
  });

  it("rejects writes with another tenant_id", async () => {
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);

    await expect(
      app.query(
        "INSERT INTO sectors (tenant_id, name) VALUES ($1, 'Cross tenant attempt')",
        [tenantB],
      ),
    ).rejects.toThrow();

    await app.query("ROLLBACK");
  });

  it("fails closed when tenant context is absent", async () => {
    const result = await app.query("SELECT id FROM sectors WHERE id = $1", [sectorA]);
    expect(result.rowCount).toBe(0);
  });
});
