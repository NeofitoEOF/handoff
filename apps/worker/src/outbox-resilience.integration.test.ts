import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const { Client } = pg;

const adminUrl = process.env.MIGRATION_DATABASE_URL;
const appUrl = process.env.DATABASE_URL;
const enabled = Boolean(adminUrl && appUrl);
const suite = enabled ? describe : describe.skip;

suite("worker outbox resilience", () => {
  let admin: pg.Client;
  let workerA: pg.Client;
  let workerB: pg.Client;
  let tenantId = "";

  async function beginTenant(client: pg.Client) {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  }

  async function insertEmail(dedupeKey: string) {
    await workerA.query("BEGIN");
    await workerA.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await workerA.query<{ id: string }>(
      `INSERT INTO email_outbox
        (tenant_id, recipient_email, subject, body_text, dedupe_key)
       VALUES ($1, 'worker-test@example.test', 'Worker test', 'Body', $2)
       RETURNING id`,
      [tenantId, dedupeKey],
    );
    await workerA.query("COMMIT");
    return result.rows[0]!.id;
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl! });
    workerA = new Client({ connectionString: appUrl! });
    workerB = new Client({ connectionString: appUrl! });

    await Promise.all([admin.connect(), workerA.connect(), workerB.connect()]);

    const tenant = await admin.query<{ id: string }>(
      `INSERT INTO tenants (name, subdomain)
       VALUES ('Worker resilience test', 'worker-resilience-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
    );

    tenantId = tenant.rows[0]!.id;
  });

  afterAll(async () => {
    await Promise.all([
      admin?.end(),
      workerA?.end(),
      workerB?.end(),
    ]);
  });

  it("prevents two workers from claiming the same row with SKIP LOCKED", async () => {
    const id = await insertEmail("claim-once");

    await beginTenant(workerA);
    const first = await workerA.query<{ id: string }>(
      `SELECT id
         FROM email_outbox
        WHERE status IN ('PENDING', 'FAILED')
          AND available_at <= now()
          AND attempts < 5
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
    );

    expect(first.rows[0]?.id).toBe(id);

    await beginTenant(workerB);
    const second = await workerB.query<{ id: string }>(
      `SELECT id
         FROM email_outbox
        WHERE status IN ('PENDING', 'FAILED')
          AND available_at <= now()
          AND attempts < 5
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
    );

    expect(second.rowCount).toBe(0);

    await workerB.query("ROLLBACK");
    await workerA.query("ROLLBACK");
  });

  it("reclaims PROCESSING rows only after the processing lease expires", async () => {
    const staleId = await insertEmail("stale-lease");
    const freshId = await insertEmail("fresh-lease");

    await beginTenant(workerA);
    await workerA.query(
      `UPDATE email_outbox
          SET status = 'PROCESSING',
              processing_started_at = CASE
                WHEN id = $1 THEN now() - interval '60 minutes'
                WHEN id = $2 THEN now()
              END
        WHERE id = ANY($3::uuid[])`,
      [staleId, freshId, [staleId, freshId]],
    );
    await workerA.query("COMMIT");

    await beginTenant(workerA);
    const claimable = await workerA.query<{ id: string }>(
      `SELECT id
         FROM email_outbox
        WHERE (
          (status IN ('PENDING', 'FAILED') AND available_at <= now())
          OR
          (status = 'PROCESSING'
            AND processing_started_at <= now() - make_interval(mins => $1))
        )
          AND attempts < 5
          AND id = ANY($2::uuid[])
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED`,
      [15, [staleId, freshId]],
    );

    expect(claimable.rows.map((row) => row.id)).toEqual([staleId]);
    await workerA.query("ROLLBACK");
  });

  it("does not reclaim rows that exhausted the retry budget", async () => {
    const id = await insertEmail("retry-budget");

    await beginTenant(workerA);
    await workerA.query(
      `UPDATE email_outbox
          SET status = 'FAILED',
              attempts = 5,
              available_at = now() - interval '1 minute'
        WHERE id = $1`,
      [id],
    );

    const claimable = await workerA.query<{ id: string }>(
      `SELECT id
         FROM email_outbox
        WHERE (
          (status IN ('PENDING', 'FAILED') AND available_at <= now())
          OR
          (status = 'PROCESSING'
            AND processing_started_at <= now() - make_interval(mins => $1))
        )
          AND attempts < 5
          AND id = $2
        FOR UPDATE SKIP LOCKED`,
      [15, id],
    );

    expect(claimable.rowCount).toBe(0);
    await workerA.query("ROLLBACK");
  });

  it("deduplicates repeated enqueue attempts for the same tenant", async () => {
    await beginTenant(workerA);

    const first = await workerA.query(
      `INSERT INTO email_outbox
        (tenant_id, recipient_email, subject, body_text, dedupe_key)
       VALUES ($1, 'worker-test@example.test', 'First', 'Body', 'same-business-event')
       ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
      [tenantId],
    );

    const second = await workerA.query(
      `INSERT INTO email_outbox
        (tenant_id, recipient_email, subject, body_text, dedupe_key)
       VALUES ($1, 'worker-test@example.test', 'Duplicate', 'Body', 'same-business-event')
       ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
      [tenantId],
    );

    expect(first.rowCount).toBe(1);
    expect(second.rowCount).toBe(0);

    await workerA.query("ROLLBACK");
  });
});
