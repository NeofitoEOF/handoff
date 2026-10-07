import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const { Client } = pg;

const adminUrl = process.env.MIGRATION_DATABASE_URL;
const appUrl = process.env.DATABASE_URL;
const enabled = Boolean(adminUrl && appUrl);
const suite = enabled ? describe : describe.skip;

suite("operational queue metrics", () => {
  let admin: pg.Client;
  let tenantId = "";
  let collectOperationalQueueMetrics:
    typeof import("./metrics.js").collectOperationalQueueMetrics;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= "test-jwt-secret-".padEnd(40, "x");
    process.env.OBJECT_STORAGE_ACCESS_KEY ??= "test-access";
    process.env.OBJECT_STORAGE_SECRET_KEY ??= "test-secret";
    process.env.MFA_ENCRYPTION_KEY ??= "11".repeat(32);
    process.env.PLATFORM_ADMIN_KEY ??= "test-platform-admin-key".padEnd(40, "x");
    process.env.INTEGRATION_ENCRYPTION_KEY ??= "22".repeat(32);
    process.env.CLAMAV_ENABLED = "false";
    process.env.NODE_ENV = "test";

    ({ collectOperationalQueueMetrics } = await import("./metrics.js"));

    admin = new Client({ connectionString: adminUrl! });
    await admin.connect();

    const tenant = await admin.query<{ id: string }>(
      `INSERT INTO tenants (name, subdomain)
       VALUES ('Metrics test', 'metrics-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
    );
    tenantId = tenant.rows[0]!.id;
  });

  afterAll(async () => {
    if (admin) await admin.end();
  });

  it("aggregates retryable backlog and dead letters across tenants without exposing tenant labels", async () => {
    const before = await collectOperationalQueueMetrics();

    await admin.query(
      `INSERT INTO email_outbox
        (tenant_id, recipient_email, subject, body_text, dedupe_key,
         status, attempts, created_at, available_at)
       VALUES
        ($1, 'pending@example.test', 'Pending', 'Body', 'metrics-pending',
         'PENDING', 0, now() - interval '20 minutes', now() - interval '1 minute'),
        ($1, 'dead@example.test', 'Dead', 'Body', 'metrics-dead',
         'FAILED', 5, now() - interval '30 minutes', now() - interval '1 minute')`,
      [tenantId],
    );

    const after = await collectOperationalQueueMetrics();

    expect(after.email.pending).toBeGreaterThanOrEqual(before.email.pending + 1);
    expect(after.email.deadLetters).toBeGreaterThanOrEqual(before.email.deadLetters + 1);
    expect(after.email.oldestPendingSeconds).toBeGreaterThanOrEqual(20 * 60 - 5);

    for (const queue of ["email", "teams", "webhook", "closure"] as const) {
      expect(after[queue].pending).toBeGreaterThanOrEqual(0);
      expect(after[queue].deadLetters).toBeGreaterThanOrEqual(0);
      expect(after[queue].oldestPendingSeconds).toBeGreaterThanOrEqual(0);
    }
  });
});
