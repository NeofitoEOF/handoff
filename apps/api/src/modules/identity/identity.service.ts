import argon2 from "argon2";
import { withTenantTransaction } from "../../db.js";
import {
  createScopedToken,
  hashScopedToken,
  tenantIdFromScopedToken,
} from "./scoped-token.js";

const REFRESH_TTL_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function authenticatePassword(input: {
  tenantId: string;
  email: string;
  password: string;
}) {
  const user = await withTenantTransaction(input.tenantId, async (client) => {
    const result = await client.query<{
      id: string;
      email: string;
      name: string;
      password_hash: string | null;
      tenant_active: boolean;
      membership_active: boolean;
    }>(
      `SELECT u.id, u.email, u.name, u.password_hash,
              t.active AS tenant_active,
              tu.active AS membership_active
         FROM users u
         JOIN tenant_users tu ON tu.user_id = u.id
         JOIN tenants t ON t.id = tu.tenant_id
        WHERE lower(u.email) = lower($1)
          AND tu.tenant_id = $2
          AND u.active = true
        LIMIT 1`,
      [input.email, input.tenantId],
    );

    return result.rows[0] ?? null;
  });

  if (!user || !user.password_hash || !user.tenant_active || !user.membership_active) {
    return { kind: "invalid_credentials" as const };
  }

  const valid = await argon2.verify(user.password_hash, input.password);
  if (!valid) return { kind: "invalid_credentials" as const };

  return {
    kind: "ok" as const,
    user: { id: user.id, email: user.email, name: user.name },
  };
}

export async function createRefreshSession(input: {
  tenantId: string;
  userId: string;
  userAgent?: string;
  ip?: string;
  rotatedFrom?: string;
}) {
  const token = createScopedToken(input.tenantId, 48);
  const tokenHash = hashScopedToken(token);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  const session = await withTenantTransaction(input.tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO refresh_sessions
        (tenant_id, user_id, token_hash, user_agent, ip, expires_at, rotated_from)
       VALUES ($1, $2, $3, $4, $5::inet, $6, $7)
       RETURNING id`,
      [
        input.tenantId,
        input.userId,
        tokenHash,
        input.userAgent ?? null,
        input.ip ?? null,
        expiresAt,
        input.rotatedFrom ?? null,
      ],
    );
    return result.rows[0]!;
  });

  return { token, sessionId: session.id, expiresAt };
}

export async function rotateRefreshSession(input: {
  token: string;
  userAgent?: string;
  ip?: string;
}) {
  const tenantId = tenantIdFromScopedToken(input.token);
  if (!tenantId) {
    return { kind: "invalid_refresh" as const };
  }

  const tokenHash = hashScopedToken(input.token);

  return withTenantTransaction(tenantId, async (client) => {
    const locked = await client.query<{
      id: string;
      tenant_id: string;
      user_id: string;
      expires_at: Date;
      revoked_at: Date | null;
      created_at: Date;
      password_changed_at: Date | null;
    }>(
      `SELECT
          rs.id,
          rs.tenant_id,
          rs.user_id,
          rs.expires_at,
          rs.revoked_at,
          rs.created_at,
          u.password_changed_at
         FROM refresh_sessions rs
         JOIN users u ON u.id = rs.user_id
        WHERE rs.token_hash = $1
        LIMIT 1
        FOR UPDATE OF rs`,
      [tokenHash],
    );

    const current = locked.rows[0];
    if (
      !current ||
      current.revoked_at ||
      current.expires_at.getTime() <= Date.now() ||
      (current.password_changed_at &&
        current.password_changed_at.getTime() > current.created_at.getTime())
    ) {
      return { kind: "invalid_refresh" as const };
    }

    await client.query(
      `UPDATE refresh_sessions
          SET revoked_at = now()
        WHERE id = $1`,
      [current.id],
    );

    const token = createScopedToken(tenantId, 48);
    const newHash = hashScopedToken(token);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

    const next = await client.query<{ id: string }>(
      `INSERT INTO refresh_sessions
        (tenant_id, user_id, token_hash, user_agent, ip, expires_at, rotated_from)
       VALUES ($1, $2, $3, $4, $5::inet, $6, $7)
       RETURNING id`,
      [
        tenantId,
        current.user_id,
        newHash,
        input.userAgent ?? null,
        input.ip ?? null,
        expiresAt,
        current.id,
      ],
    );

    return {
      kind: "rotated" as const,
      token,
      sessionId: next.rows[0]!.id,
      expiresAt,
      tenantId,
      userId: current.user_id,
    };
  });
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const tenantId = tenantIdFromScopedToken(token);
  if (!tenantId) return;

  const tokenHash = hashScopedToken(token);
  await withTenantTransaction(tenantId, async (client) => {
    await client.query(
      `UPDATE refresh_sessions
          SET revoked_at = COALESCE(revoked_at, now())
        WHERE token_hash = $1`,
      [tokenHash],
    );
  });
}
