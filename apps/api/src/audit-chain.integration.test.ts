import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const { Client } = pg;

const adminUrl = process.env.MIGRATION_DATABASE_URL;
const appUrl = process.env.DATABASE_URL;
const enabled = Boolean(adminUrl && appUrl);
const suite = enabled ? describe : describe.skip;

suite("audit hash chain", () => {
  let admin: pg.Client;
  let app: pg.Client;
  let tenantId = "";

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl! });
    app = new Client({ connectionString: appUrl! });
    await admin.connect();
    await app.connect();

    const tenant = await admin.query<{ id: string }>(
      `INSERT INTO tenants (name, subdomain)
       VALUES ('Audit chain test', 'audit-chain-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
    );
    tenantId = tenant.rows[0]!.id;
  });

  afterAll(async () => {
    if (app) await app.end();
    if (admin) await admin.end();
  });

  it("chains consecutive events for the same tenant", async () => {
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const first = await app.query<{ id: string; chain_seq: string; prev_hash: string | null; hash: string }>(
      `INSERT INTO audit_events
        (tenant_id, action, entity_type, entity_id, after_data)
       VALUES ($1, 'TEST_FIRST', 'test', gen_random_uuid(), '{"value":1}'::jsonb)
       RETURNING id, chain_seq::text, prev_hash, hash`,
      [tenantId],
    );

    const second = await app.query<{ id: string; chain_seq: string; prev_hash: string | null; hash: string }>(
      `INSERT INTO audit_events
        (tenant_id, action, entity_type, entity_id, after_data)
       VALUES ($1, 'TEST_SECOND', 'test', gen_random_uuid(), '{"value":2}'::jsonb)
       RETURNING id, chain_seq::text, prev_hash, hash`,
      [tenantId],
    );

    expect(first.rows[0]!.chain_seq).toBe("1");
    expect(first.rows[0]!.prev_hash).toBeNull();
    expect(first.rows[0]!.hash).toMatch(/^[a-f0-9]{64}$/);

    expect(second.rows[0]!.chain_seq).toBe("2");
    expect(second.rows[0]!.prev_hash).toBe(first.rows[0]!.hash);
    expect(second.rows[0]!.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.rows[0]!.hash).not.toBe(first.rows[0]!.hash);

    await app.query("ROLLBACK");
  });

  it("serializes chain sequence across committed inserts", async () => {
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const result = await app.query<{ chain_seq: string; prev_hash: string | null; hash: string }>(
      `INSERT INTO audit_events
        (tenant_id, action, entity_type, entity_id)
       VALUES ($1, 'TEST_COMMITTED', 'test', gen_random_uuid())
       RETURNING chain_seq::text, prev_hash, hash`,
      [tenantId],
    );

    expect(result.rows[0]!.chain_seq).toBe("1");
    expect(result.rows[0]!.prev_hash).toBeNull();

    await app.query("COMMIT");

    const rows = await admin.query<{ chain_seq: string; prev_hash: string | null; hash: string }>(
      `SELECT chain_seq::text, prev_hash, hash
         FROM audit_events
        WHERE tenant_id = $1
        ORDER BY chain_seq`,
      [tenantId],
    );

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.chain_seq).toBe("1");
    expect(rows.rows[0]!.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps numeric order beyond nine events", async () => {
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    for (let index = 0; index < 12; index += 1) {
      await app.query(
        `INSERT INTO audit_events
          (tenant_id, action, entity_type, entity_id, after_data)
         VALUES ($1, $2, 'test', gen_random_uuid(), jsonb_build_object('index', $3::int))`,
        [tenantId, `TEST_SEQUENCE_${index + 1}`, index + 1],
      );
    }

    const ordered = await app.query<{ chain_seq: string }>(
      `SELECT chain_seq::text
         FROM audit_events
        WHERE tenant_id = $1
        ORDER BY audit_events.chain_seq ASC`,
      [tenantId],
    );

    expect(ordered.rows.map((row) => Number(row.chain_seq))).toEqual(
      Array.from({ length: 13 }, (_, index) => index + 1),
    );

    await app.query("ROLLBACK");
  });
});
