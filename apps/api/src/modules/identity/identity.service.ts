import crypto from "node:crypto";
import argon2 from "argon2";
import { pool, withTenantTransaction } from "../../db.js";

const REFRESH_TTL_DAYS = 30;

function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newRefreshToken(): string {
  return crypto.randomBytes(48).toString("base64url");
}

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
  const client = await pool.connect();
  try {
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

    const user = result.rows[0];
    if (!user || !user.password_hash || !user.tenant_active || !user.membership_active) {
      return { kind: "invalid_credentials" as const };
    }

    const valid = await argon2.verify(user.password_hash, input.password);
    if (!valid) return { kind: "invalid_credentials" as const };

    return { kind: "ok" as const, user: { id: user.id, email: user.email, name: user.name } };
  } finally {
    client.release();
  }
}

export async function createRefreshSession(input: {
  tenantId: string;
  userId: string;
  userAgent?: string;
  ip?: string;
  rotatedFrom?: string;
}) {
  const token = newRefreshToken();
  const tokenHash = hashRefreshToken(token);
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
  const tokenHash = hashRefreshToken(input.token);

  const lookup = await pool.query<{
    id: string;
    tenant_id: string;
    user_id: string;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT id, tenant_id, user_id, expires_at, revoked_at
       FROM refresh_sessions
      WHERE token_hash = $1
      LIMIT 1`,
    [tokenHash],
  );

  const current = lookup.rows[0];
  if (!current || current.revoked_at || current.expires_at.getTime() <= Date.now()) {
    return { kind: "invalid_refresh" as const };
  }

  return withTenantTransaction(current.tenant_id, async (client) => {
    const locked = await client.query<{
      id: string;
      revoked_at: Date | null;
      expires_at: Date;
    }>(
      `SELECT id, revoked_at, expires_at
         FROM refresh_sessions
        WHERE id = $1
        FOR UPDATE`,
      [current.id],
    );

    const session = locked.rows[0];
    if (!session || session.revoked_at || session.expires_at.getTime() <= Date.now()) {
      return { kind: "invalid_refresh" as const };
    }

    await client.query(
      `UPDATE refresh_sessions SET revoked_at = now() WHERE id = $1`,
      [current.id],
    );

    const token = newRefreshToken();
    const newHash = hashRefreshToken(token);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

    const next = await client.query<{ id: string }>(
      `INSERT INTO refresh_sessions
        (tenant_id, user_id, token_hash, user_agent, ip, expires_at, rotated_from)
       VALUES ($1, $2, $3, $4, $5::inet, $6, $7)
       RETURNING id`,
      [
        current.tenant_id,
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
      tenantId: current.tenant_id,
      userId: current.user_id,
    };
  });
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const tokenHash = hashRefreshToken(token);
  await pool.query(
    `UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = $1`,
    [tokenHash],
  );
}
