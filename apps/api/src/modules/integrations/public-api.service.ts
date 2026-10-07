import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import { withTenantTransaction, type DbClient } from "../../db.js";
import { isTenantAdmin } from "../../authorization.js";
import { encryptIntegrationSecret } from "../integrations/integration-crypto.js";

export type PublicApiScope = "requests:read";

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseTokenTenantId(token: string): string | null {
  const match = /^hnd_([0-9a-fA-F-]{36})_[A-Za-z0-9_-]{20,}$/.exec(token);
  return match?.[1] ?? null;
}

export async function createApiKey(input: {
  tenantId: string;
  actorUserId: string;
  name: string;
  scopes: PublicApiScope[];
  expiresAt?: Date;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await isTenantAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const secret = crypto.randomBytes(32).toString("base64url");
    const token = `hnd_${input.tenantId}_${secret}`;
    const tokenHash = sha256(token);
    const tokenPrefix = token.slice(0, 18);

    const result = await client.query(
      `INSERT INTO public_api_keys
        (tenant_id, name, token_prefix, token_hash, scopes, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5::text[], $6, $7)
       RETURNING id, name, token_prefix, scopes, expires_at, created_at`,
      [
        input.tenantId,
        input.name,
        tokenPrefix,
        tokenHash,
        input.scopes,
        input.actorUserId,
        input.expiresAt ?? null,
      ],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'PUBLIC_API_KEY_CREATED', 'public_api_key', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        result.rows[0].id,
        JSON.stringify({ name: input.name, scopes: input.scopes, expiresAt: input.expiresAt ?? null }),
      ],
    );

    return { kind: "created" as const, apiKey: result.rows[0], token };
  });
}

export async function listApiKeys(input: { tenantId: string; actorUserId: string }) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await isTenantAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const result = await client.query(
      `SELECT id, name, token_prefix, scopes, expires_at, revoked_at, last_used_at, created_at
         FROM public_api_keys
        ORDER BY created_at DESC`,
    );

    return { kind: "ok" as const, data: result.rows };
  });
}

export async function revokeApiKey(input: {
  tenantId: string;
  actorUserId: string;
  apiKeyId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await isTenantAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const result = await client.query(
      `UPDATE public_api_keys
          SET revoked_at = COALESCE(revoked_at, now())
        WHERE id = $1
       RETURNING id, revoked_at`,
      [input.apiKeyId],
    );

    if (!result.rows[0]) return { kind: "not_found" as const };

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'PUBLIC_API_KEY_REVOKED', 'public_api_key', $3, $4::jsonb)`,
      [input.tenantId, input.actorUserId, input.apiKeyId, JSON.stringify({ revoked: true })],
    );

    return { kind: "revoked" as const };
  });
}

export async function authenticatePublicApiRequest(
  request: FastifyRequest,
  requiredScope: PublicApiScope,
) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return { kind: "unauthorized" as const };
  }

  const token = authorization.slice("Bearer ".length).trim();
  const tenantId = parseTokenTenantId(token);
  if (!tenantId) return { kind: "unauthorized" as const };

  return withTenantTransaction(tenantId, async (client) => {
    const result = await client.query<{
      id: string;
      scopes: string[];
      expires_at: Date | null;
    }>(
      `SELECT id, scopes, expires_at
         FROM public_api_keys
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())
        LIMIT 1`,
      [sha256(token)],
    );

    const key = result.rows[0];
    if (!key || !key.scopes.includes(requiredScope)) {
      return { kind: "unauthorized" as const };
    }

    await client.query(
      `UPDATE public_api_keys SET last_used_at = now() WHERE id = $1`,
      [key.id],
    );

    return { kind: "ok" as const, tenantId, apiKeyId: key.id, scopes: key.scopes };
  });
}

function validateWebhookUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local")
  ) {
    return false;
  }

  if (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host)
  ) {
    return false;
  }

  return true;
}

export async function createWebhook(input: {
  tenantId: string;
  actorUserId: string;
  url: string;
  events: Array<"request.approved" | "request.overdue">;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await isTenantAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }
    if (!validateWebhookUrl(input.url)) {
      return { kind: "invalid_url" as const };
    }

    const secret = crypto.randomBytes(32).toString("base64url");
    const encrypted = encryptIntegrationSecret(secret);

    const result = await client.query(
      `INSERT INTO webhooks
        (tenant_id, url, events, secret_ciphertext, secret_iv, secret_tag, created_by)
       VALUES ($1, $2, $3::text[], $4, $5, $6, $7)
       RETURNING id, url, events, active, created_at`,
      [
        input.tenantId,
        input.url,
        input.events,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.tag,
        input.actorUserId,
      ],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'WEBHOOK_CREATED', 'webhook', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        result.rows[0].id,
        JSON.stringify({ url: input.url, events: input.events }),
      ],
    );

    return { kind: "created" as const, webhook: result.rows[0], secret };
  });
}

export async function listWebhooks(input: { tenantId: string; actorUserId: string }) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await isTenantAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const result = await client.query(
      `SELECT id, url, events, active, created_at, updated_at
         FROM webhooks
        ORDER BY created_at DESC`,
    );

    return { kind: "ok" as const, data: result.rows };
  });
}

export async function disableWebhook(input: {
  tenantId: string;
  actorUserId: string;
  webhookId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await isTenantAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const result = await client.query(
      `UPDATE webhooks
          SET active = false, updated_at = now()
        WHERE id = $1
       RETURNING id`,
      [input.webhookId],
    );
    if (!result.rows[0]) return { kind: "not_found" as const };

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'WEBHOOK_DISABLED', 'webhook', $3, '{"active":false}'::jsonb)`,
      [input.tenantId, input.actorUserId, input.webhookId],
    );

    return { kind: "disabled" as const };
  });
}

export async function enqueueWebhookEvent(
  client: DbClient,
  input: {
    tenantId: string;
    eventType: "request.approved" | "request.overdue";
    dedupeKey: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const hooks = await client.query<{ id: string }>(
    `SELECT id
       FROM webhooks
      WHERE active = true
        AND $1 = ANY(events)`,
    [input.eventType],
  );

  for (const hook of hooks.rows) {
    await client.query(
      `INSERT INTO webhook_outbox
        (tenant_id, webhook_id, event_type, payload, dedupe_key)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (tenant_id, webhook_id, dedupe_key) DO NOTHING`,
      [
        input.tenantId,
        hook.id,
        input.eventType,
        JSON.stringify(input.payload),
        input.dedupeKey,
      ],
    );
  }
}
