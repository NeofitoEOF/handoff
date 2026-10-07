import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "../../config.js";
import { pool, withTenantTransaction } from "../../db.js";
import { isTenantAdmin } from "../../authorization.js";

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function requireMicrosoftConfig() {
  if (!config.MICROSOFT_CLIENT_ID || !config.MICROSOFT_CLIENT_SECRET || !config.MICROSOFT_REDIRECT_URI) {
    throw new Error("Microsoft OIDC integration is not configured.");
  }
  return {
    clientId: config.MICROSOFT_CLIENT_ID,
    clientSecret: config.MICROSOFT_CLIENT_SECRET,
    redirectUri: config.MICROSOFT_REDIRECT_URI,
  };
}

export async function configureMicrosoftIntegration(input: {
  tenantId: string;
  actorUserId: string;
  entraTenantId: string;
  enabled: boolean;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await isTenantAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    await client.query(
      `INSERT INTO tenant_microsoft_integrations
        (tenant_id, entra_tenant_id, enabled, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id)
       DO UPDATE SET
         entra_tenant_id = EXCLUDED.entra_tenant_id,
         enabled = EXCLUDED.enabled,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()`,
      [input.tenantId, input.entraTenantId, input.enabled, input.actorUserId],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'MICROSOFT_INTEGRATION_CONFIGURED', 'tenant', $1, $3::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        JSON.stringify({ entraTenantId: input.entraTenantId, enabled: input.enabled }),
      ],
    );

    return { kind: "saved" as const };
  });
}

export async function getMicrosoftIntegration(input: {
  tenantId: string;
  actorUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await isTenantAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }
    const result = await client.query(
      `SELECT entra_tenant_id, enabled, updated_at
         FROM tenant_microsoft_integrations
        WHERE tenant_id = $1`,
      [input.tenantId],
    );
    return { kind: "ok" as const, integration: result.rows[0] ?? null };
  });
}

export async function startMicrosoftLogin(subdomain: string) {
  const microsoft = requireMicrosoftConfig();

  const tenant = await pool.query<{ id: string }>(
    `SELECT id FROM tenants
      WHERE lower(subdomain) = lower($1) AND active = true
      LIMIT 1`,
    [subdomain],
  );
  const tenantId = tenant.rows[0]?.id;
  if (!tenantId) return { kind: "tenant_not_found" as const };

  const integration = await withTenantTransaction(tenantId, async (client) => {
    const result = await client.query<{ entra_tenant_id: string; enabled: boolean }>(
      `SELECT entra_tenant_id, enabled
         FROM tenant_microsoft_integrations
        WHERE tenant_id = $1`,
      [tenantId],
    );
    return result.rows[0] ?? null;
  });

  if (!integration?.enabled) return { kind: "not_enabled" as const };

  const state = base64url(crypto.randomBytes(32));
  const nonce = base64url(crypto.randomBytes(32));
  const codeVerifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await pool.query(
    `INSERT INTO microsoft_oidc_states
      (state_hash, tenant_id, nonce, code_verifier, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [hash(state), tenantId, nonce, codeVerifier, expiresAt],
  );

  const params = new URLSearchParams({
    client_id: microsoft.clientId,
    response_type: "code",
    redirect_uri: microsoft.redirectUri,
    response_mode: "query",
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });

  return {
    kind: "ok" as const,
    authorizeUrl: `https://login.microsoftonline.com/${encodeURIComponent(integration.entra_tenant_id)}/oauth2/v2.0/authorize?${params.toString()}`,
  };
}

export async function completeMicrosoftCallback(input: {
  state: string;
  code: string;
}) {
  const microsoft = requireMicrosoftConfig();
  const client = await pool.connect();

  let oidc: {
    tenantId: string;
    entraTenantId: string;
    nonce: string;
    codeVerifier: string;
  } | null = null;

  try {
    await client.query("BEGIN");
    const stateResult = await client.query<{
      tenant_id: string;
      nonce: string;
      code_verifier: string;
      expires_at: Date;
      used_at: Date | null;
    }>(
      `SELECT tenant_id, nonce, code_verifier, expires_at, used_at
         FROM microsoft_oidc_states
        WHERE state_hash = $1
        FOR UPDATE`,
      [hash(input.state)],
    );
    const state = stateResult.rows[0];
    if (!state || state.used_at || state.expires_at.getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      return { kind: "invalid_state" as const };
    }

    await client.query(
      `UPDATE microsoft_oidc_states SET used_at = now() WHERE state_hash = $1`,
      [hash(input.state)],
    );
    await client.query("COMMIT");

    const integration = await withTenantTransaction(state.tenant_id, async (tenantClient) => {
      const result = await tenantClient.query<{ entra_tenant_id: string; enabled: boolean }>(
        `SELECT entra_tenant_id, enabled
           FROM tenant_microsoft_integrations
          WHERE tenant_id = $1`,
        [state.tenant_id],
      );
      return result.rows[0] ?? null;
    });

    if (!integration?.enabled) return { kind: "not_enabled" as const };
    oidc = {
      tenantId: state.tenant_id,
      entraTenantId: integration.entra_tenant_id,
      nonce: state.nonce,
      codeVerifier: state.code_verifier,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (!oidc) return { kind: "invalid_state" as const };

  const tokenResponse = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(oidc.entraTenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: microsoft.clientId,
        client_secret: microsoft.clientSecret,
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: microsoft.redirectUri,
        code_verifier: oidc.codeVerifier,
        scope: "openid profile email",
      }),
    },
  );

  if (!tokenResponse.ok) {
    return { kind: "token_exchange_failed" as const };
  }

  const tokens = await tokenResponse.json() as { id_token?: string };
  if (!tokens.id_token) return { kind: "missing_id_token" as const };

  const jwks = createRemoteJWKSet(
    new URL(
      `https://login.microsoftonline.com/${encodeURIComponent(oidc.entraTenantId)}/discovery/v2.0/keys`,
    ),
  );
  const verified = await jwtVerify(tokens.id_token, jwks, {
    audience: microsoft.clientId,
    issuer: `https://login.microsoftonline.com/${oidc.entraTenantId}/v2.0`,
  });

  if (verified.payload.nonce !== oidc.nonce) return { kind: "invalid_nonce" as const };
  if (verified.payload.tid !== oidc.entraTenantId) return { kind: "tenant_mismatch" as const };

  const emailRaw = verified.payload.preferred_username ?? verified.payload.email;
  if (typeof emailRaw !== "string") return { kind: "missing_email" as const };
  const email = emailRaw.toLowerCase();

  const user = await withTenantTransaction(oidc.tenantId, async (tenantClient) => {
    const result = await tenantClient.query<{ id: string; name: string; email: string }>(
      `SELECT u.id, u.name, u.email
         FROM users u
         JOIN tenant_users tu ON tu.user_id = u.id
        WHERE tu.tenant_id = $1
          AND lower(u.email) = lower($2)
          AND u.active = true
          AND tu.active = true
        LIMIT 1`,
      [oidc.tenantId, email],
    );
    return result.rows[0] ?? null;
  });

  if (!user) return { kind: "user_not_registered" as const };

  const ticket = base64url(crypto.randomBytes(32));
  await pool.query(
    `INSERT INTO microsoft_login_tickets
      (token_hash, tenant_id, user_id, expires_at)
     VALUES ($1, $2, $3, now() + interval '2 minutes')`,
    [hash(ticket), oidc.tenantId, user.id],
  );

  return { kind: "ok" as const, ticket };
}

export async function consumeMicrosoftTicket(ticket: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      tenant_id: string;
      user_id: string;
      expires_at: Date;
      used_at: Date | null;
    }>(
      `SELECT tenant_id, user_id, expires_at, used_at
         FROM microsoft_login_tickets
        WHERE token_hash = $1
        FOR UPDATE`,
      [hash(ticket)],
    );
    const current = result.rows[0];
    if (!current || current.used_at || current.expires_at.getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      return { kind: "invalid_ticket" as const };
    }

    await client.query(
      `UPDATE microsoft_login_tickets SET used_at = now() WHERE token_hash = $1`,
      [hash(ticket)],
    );
    await client.query("COMMIT");
    return {
      kind: "ok" as const,
      tenantId: current.tenant_id,
      userId: current.user_id,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
