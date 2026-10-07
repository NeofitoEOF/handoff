import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const { Client } = pg;

const adminUrl = process.env.MIGRATION_DATABASE_URL;
const appUrl = process.env.DATABASE_URL;
const enabled = Boolean(adminUrl && appUrl);
const suite = enabled ? describe : describe.skip;

suite("dead-letter operations", () => {
  let admin: pg.Client;
  let tenantId = "";
  let adminUserId = "";
  let regularUserId = "";
  let deadLetterId = "";

  let listDeadLetters: typeof import("./modules/operations/dead-letter.service.js").listDeadLetters;
  let retryDeadLetter: typeof import("./modules/operations/dead-letter.service.js").retryDeadLetter;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= "test-jwt-secret-".padEnd(40, "x");
    process.env.OBJECT_STORAGE_ACCESS_KEY ??= "test-access";
    process.env.OBJECT_STORAGE_SECRET_KEY ??= "test-secret";
    process.env.MFA_ENCRYPTION_KEY ??= "11".repeat(32);
    process.env.PLATFORM_ADMIN_KEY ??= "test-platform-admin-key".padEnd(40, "x");
    process.env.INTEGRATION_ENCRYPTION_KEY ??= "22".repeat(32);
    process.env.CLAMAV_ENABLED = "false";
    process.env.NODE_ENV = "test";

    ({ listDeadLetters, retryDeadLetter } = await import("./modules/operations/dead-letter.service.js"));

    admin = new Client({ connectionString: adminUrl! });
    await admin.connect();

    const tenant = await admin.query<{ id: string }>(
      `INSERT INTO tenants (name, subdomain)
       VALUES ('Dead letter test', 'dead-letter-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
    );
    tenantId = tenant.rows[0]!.id;

    const users = await admin.query<{ id: string }>(
      `INSERT INTO users (email, name)
       VALUES
         ('dl-admin-' || substr(gen_random_uuid()::text, 1, 8) || '@example.test', 'DL Admin'),
         ('dl-user-' || substr(gen_random_uuid()::text, 1, 8) || '@example.test', 'DL User')
       RETURNING id`,
    );
    adminUserId = users.rows[0]!.id;
    regularUserId = users.rows[1]!.id;

    await admin.query(
      `INSERT INTO tenant_users (tenant_id, user_id, role)
       VALUES ($1, $2, 'ADMIN'), ($1, $3, 'USER')`,
      [tenantId, adminUserId, regularUserId],
    );

    const dead = await admin.query<{ id: string }>(
      `INSERT INTO email_outbox
        (tenant_id, recipient_email, subject, body_text, dedupe_key,
         status, attempts, available_at, last_error, processing_started_at)
       VALUES
        ($1, 'recipient@example.test', 'Dead email', 'Body', 'dead-email',
         'FAILED', 5, now() - interval '1 minute', 'smtp timeout', NULL)
       RETURNING id`,
      [tenantId],
    );
    deadLetterId = dead.rows[0]!.id;
  });

  afterAll(async () => {
    if (admin) await admin.end();
  });

  it("allows tenant admin to list exhausted failures", async () => {
    const result = await listDeadLetters({
      tenantId,
      actorUserId: adminUserId,
      kind: "email",
      limit: 50,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const item = result.items.find((entry) => entry.id === deadLetterId);
    expect(item).toBeDefined();
    expect(item?.kind).toBe("email");
    expect(item?.attempts).toBe(5);
    expect(item?.lastError).toBe("smtp timeout");
  });

  it("denies dead-letter visibility to regular tenant users", async () => {
    const result = await listDeadLetters({
      tenantId,
      actorUserId: regularUserId,
      limit: 50,
    });

    expect(result.kind).toBe("forbidden");
  });

  it("requeues exhausted item and audits the administrative action", async () => {
    const result = await retryDeadLetter({
      tenantId,
      actorUserId: adminUserId,
      kind: "email",
      id: deadLetterId,
      reason: "SMTP corrigido; reprocessamento autorizado.",
    });

    expect(result.kind).toBe("requeued");

    const row = await admin.query<{
      status: string;
      attempts: number;
      last_error: string | null;
      processing_started_at: Date | null;
    }>(
      `SELECT status, attempts, last_error, processing_started_at
         FROM email_outbox
        WHERE id = $1`,
      [deadLetterId],
    );

    expect(row.rows[0]!.status).toBe("PENDING");
    expect(row.rows[0]!.attempts).toBe(0);
    expect(row.rows[0]!.last_error).toBeNull();
    expect(row.rows[0]!.processing_started_at).toBeNull();

    const audit = await admin.query<{ action: string; after_data: { queue?: string; reason?: string } }>(
      `SELECT action, after_data
         FROM audit_events
        WHERE tenant_id = $1
          AND entity_id = $2
          AND action = 'DEAD_LETTER_REQUEUED'
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId, deadLetterId],
    );

    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]!.after_data.queue).toBe("email");
    expect(audit.rows[0]!.after_data.reason).toContain("SMTP corrigido");
  });

  it("does not requeue a healthy or non-exhausted item", async () => {
    const result = await retryDeadLetter({
      tenantId,
      actorUserId: adminUserId,
      kind: "email",
      id: deadLetterId,
      reason: "Segunda tentativa manual.",
    });

    expect(result.kind).toBe("not_found");
  });
});
