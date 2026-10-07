import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const { Client } = pg;
const adminUrl = process.env.MIGRATION_DATABASE_URL;
const appUrl = process.env.DATABASE_URL;
const enabled = Boolean(adminUrl && appUrl);
const suite = enabled ? describe : describe.skip;

suite("public API and webhooks", () => {
  let admin: pg.Client;
  let tenantId = "";
  let adminUserId = "";

  let createApiKey: typeof import("./modules/integrations/public-api.service.js").createApiKey;
  let authenticatePublicApiRequest: typeof import("./modules/integrations/public-api.service.js").authenticatePublicApiRequest;
  let revokeApiKey: typeof import("./modules/integrations/public-api.service.js").revokeApiKey;
  let createWebhook: typeof import("./modules/integrations/public-api.service.js").createWebhook;
  let enqueueWebhookEvent: typeof import("./modules/integrations/public-api.service.js").enqueueWebhookEvent;
  let withTenantTransaction: typeof import("./db.js").withTenantTransaction;

  beforeAll(async () => {
    if (!enabled) return;

    process.env.JWT_SECRET ??= "test-jwt-secret-".padEnd(40, "x");
    process.env.OBJECT_STORAGE_ACCESS_KEY ??= "test-access";
    process.env.OBJECT_STORAGE_SECRET_KEY ??= "test-secret";
    process.env.MFA_ENCRYPTION_KEY ??= "11".repeat(32);
    process.env.PLATFORM_ADMIN_KEY ??= "test-platform-admin-key".padEnd(40, "x");
    process.env.INTEGRATION_ENCRYPTION_KEY ??= "22".repeat(32);
    process.env.CLAMAV_ENABLED = "false";
    process.env.NODE_ENV = "test";

    ({
      createApiKey,
      authenticatePublicApiRequest,
      revokeApiKey,
      createWebhook,
      enqueueWebhookEvent,
    } = await import("./modules/integrations/public-api.service.js"));
    ({ withTenantTransaction } = await import("./db.js"));

    admin = new Client({ connectionString: adminUrl! });
    await admin.connect();

    const tenant = await admin.query<{ id: string }>(
      `INSERT INTO tenants (name, subdomain)
       VALUES ('Public API Test', 'public-api-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
    );
    tenantId = tenant.rows[0]!.id;

    const user = await admin.query<{ id: string }>(
      `INSERT INTO users (email, name)
       VALUES ('api-admin-' || substr(gen_random_uuid()::text, 1, 8) || '@example.test', 'API Admin')
       RETURNING id`,
    );
    adminUserId = user.rows[0]!.id;

    await admin.query(
      `INSERT INTO tenant_users (tenant_id, user_id, role)
       VALUES ($1, $2, 'ADMIN')`,
      [tenantId, adminUserId],
    );
  });

  afterAll(async () => {
    if (admin) await admin.end();
  });

  it("stores only the API key hash, authenticates scope, and rejects revoked keys", async () => {
    const created = await createApiKey({
      tenantId,
      actorUserId: adminUserId,
      name: "ERP",
      scopes: ["requests:read"],
    });

    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;

    expect(created.token).toMatch(/^hnd_/);

    const dbRow = await admin.query<{ token_hash: string; token_prefix: string }>(
      `SELECT token_hash, token_prefix FROM public_api_keys WHERE id = $1`,
      [created.apiKey.id],
    );

    expect(dbRow.rows[0]!.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(dbRow.rows[0]!.token_hash).not.toContain(created.token);
    expect(created.token.startsWith(dbRow.rows[0]!.token_prefix)).toBe(true);

    const request = {
      headers: { authorization: `Bearer ${created.token}` },
    } as never;

    const authenticated = await authenticatePublicApiRequest(request, "requests:read");
    expect(authenticated.kind).toBe("ok");

    const revoked = await revokeApiKey({
      tenantId,
      actorUserId: adminUserId,
      apiKeyId: created.apiKey.id as string,
    });
    expect(revoked.kind).toBe("revoked");

    const afterRevocation = await authenticatePublicApiRequest(request, "requests:read");
    expect(afterRevocation.kind).toBe("unauthorized");
  });

  it("encrypts webhook secret and enqueues each event once", async () => {
    const created = await createWebhook({
      tenantId,
      actorUserId: adminUserId,
      url: "https://hooks.example.test/handoff",
      events: ["request.approved", "request.overdue"],
    });

    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;

    const stored = await admin.query<{
      secret_ciphertext: string;
      secret_iv: string;
      secret_tag: string;
    }>(
      `SELECT secret_ciphertext, secret_iv, secret_tag FROM webhooks WHERE id = $1`,
      [created.webhook.id],
    );

    expect(stored.rows[0]!.secret_ciphertext).not.toContain(created.secret);
    expect(stored.rows[0]!.secret_iv.length).toBeGreaterThan(0);
    expect(stored.rows[0]!.secret_tag.length).toBeGreaterThan(0);

    await withTenantTransaction(tenantId, async (client) => {
      const event = {
        tenantId,
        eventType: "request.approved" as const,
        dedupeKey: "request:acceptance:approved",
        payload: { requestId: "11111111-1111-1111-1111-111111111111", status: "APPROVED" },
      };
      await enqueueWebhookEvent(client, event);
      await enqueueWebhookEvent(client, event);
    });

    const outbox = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM webhook_outbox
        WHERE tenant_id = $1
          AND webhook_id = $2
          AND dedupe_key = 'request:acceptance:approved'`,
      [tenantId, created.webhook.id],
    );

    expect(outbox.rows[0]!.count).toBe("1");
  });

  it("rejects local/private webhook targets", async () => {
    const created = await createWebhook({
      tenantId,
      actorUserId: adminUserId,
      url: "https://127.0.0.1/internal",
      events: ["request.approved"],
    });

    expect(created.kind).toBe("invalid_url");
  });
});
