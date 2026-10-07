import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const { Client } = pg;
const adminUrl = process.env.MIGRATION_DATABASE_URL;
const enabled = Boolean(adminUrl);
const suite = enabled ? describe : describe.skip;

suite("audit anchors database invariants", () => {
  let admin: pg.Client;
  let tenantId = "";

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl! });
    await admin.connect();

    const tenant = await admin.query<{ id: string }>(
      `INSERT INTO tenants (name, subdomain)
       VALUES ('Audit Anchor Test', 'audit-anchor-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
    );
    tenantId = tenant.rows[0]!.id;
  });

  afterAll(async () => {
    if (admin) await admin.end();
  });

  it("binds an anchor to an existing chain position and makes it append-only", async () => {
    const event = await admin.query<{ chain_seq: string; hash: string }>(
      `INSERT INTO audit_events
        (tenant_id, action, entity_type, entity_id, after_data)
       VALUES ($1, 'ANCHOR_TEST_EVENT', 'test', gen_random_uuid(), '{"ok":true}'::jsonb)
       RETURNING chain_seq::text, hash`,
      [tenantId],
    );

    const chainSeq = event.rows[0]!.chain_seq;
    const chainHash = event.rows[0]!.hash;

    const anchor = await admin.query<{ id: string }>(
      `INSERT INTO audit_anchors
        (tenant_id, anchor_date, chain_seq, chain_hash, manifest_sha256,
         storage_bucket, storage_key)
       VALUES ($1, current_date - 1, $2, $3, $4, 'audit-test', 'anchor.json')
       RETURNING id`,
      [tenantId, Number(chainSeq), chainHash, "b".repeat(64)],
    );

    const linked = await admin.query<{ event_hash: string; chain_hash: string }>(
      `SELECT ae.hash AS event_hash, aa.chain_hash
         FROM audit_anchors aa
         JOIN audit_events ae
           ON ae.tenant_id = aa.tenant_id
          AND ae.chain_seq = aa.chain_seq
        WHERE aa.id = $1`,
      [anchor.rows[0]!.id],
    );

    expect(linked.rows[0]!.event_hash).toBe(linked.rows[0]!.chain_hash);

    await expect(
      admin.query(
        `UPDATE audit_anchors SET storage_key = 'mutated.json' WHERE id = $1`,
        [anchor.rows[0]!.id],
      ),
    ).rejects.toThrow(/append-only/);

    await expect(
      admin.query(`DELETE FROM audit_anchors WHERE id = $1`, [anchor.rows[0]!.id]),
    ).rejects.toThrow(/append-only/);
  });
});
