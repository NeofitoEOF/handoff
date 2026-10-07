import { withTenantTransaction } from "../../db.js";
import { hashPassword } from "./identity.service.js";
import { enqueueEmail } from "../notifications/notification.service.js";
import { config } from "../../config.js";
import {
  createScopedToken,
  hashScopedToken,
  tenantIdFromScopedToken,
} from "./scoped-token.js";

export async function createPasswordReset(input: {
  tenantId: string;
  email: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const user = await client.query<{ id: string }>(
      `SELECT u.id
         FROM users u
         JOIN tenant_users tu ON tu.user_id = u.id
        WHERE lower(u.email) = lower($1)
          AND tu.tenant_id = $2
          AND u.active = true
          AND tu.active = true
        LIMIT 1`,
      [input.email, input.tenantId],
    );

    const currentUser = user.rows[0];
    if (!currentUser) {
      return { kind: "accepted" as const, token: undefined };
    }

    const token = createScopedToken(input.tenantId);
    const tokenHash = hashScopedToken(token);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await client.query(
      `UPDATE password_reset_tokens
          SET used_at = now()
        WHERE tenant_id = $1
          AND user_id = $2
          AND used_at IS NULL`,
      [input.tenantId, currentUser.id],
    );

    await client.query(
      `INSERT INTO password_reset_tokens
        (tenant_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [input.tenantId, currentUser.id, tokenHash, expiresAt],
    );

    await enqueueEmail(client, {
      tenantId: input.tenantId,
      recipientEmail: input.email,
      subject: "[Handoff] Recuperação de senha",
      bodyText: `Use o link ${config.APP_BASE_URL}/reset-password?token=${encodeURIComponent(token)}. O link expira em 30 minutos.`,
      dedupeKey: `password-reset:${currentUser.id}:${tokenHash}`,
    });

    return { kind: "accepted" as const, token, expiresAt };
  });
}

export async function consumePasswordReset(input: {
  token: string;
  newPassword: string;
}) {
  const tenantId = tenantIdFromScopedToken(input.token);
  if (!tenantId) {
    return { kind: "invalid_token" as const };
  }

  const tokenHash = hashScopedToken(input.token);

  const current = await withTenantTransaction(tenantId, async (client) => {
    const result = await client.query<{
      id: string;
      user_id: string;
      expires_at: Date;
      used_at: Date | null;
    }>(
      `SELECT id, user_id, expires_at, used_at
         FROM password_reset_tokens
        WHERE token_hash = $1
        LIMIT 1`,
      [tokenHash],
    );
    return result.rows[0] ?? null;
  });

  if (!current || current.used_at || current.expires_at.getTime() <= Date.now()) {
    return { kind: "invalid_token" as const };
  }

  const hash = await hashPassword(input.newPassword);

  return withTenantTransaction(tenantId, async (client) => {
    const locked = await client.query<{
      user_id: string;
      expires_at: Date;
      used_at: Date | null;
    }>(
      `SELECT user_id, expires_at, used_at
         FROM password_reset_tokens
        WHERE id = $1
        FOR UPDATE`,
      [current.id],
    );

    const token = locked.rows[0];
    if (!token || token.used_at || token.expires_at.getTime() <= Date.now()) {
      return { kind: "invalid_token" as const };
    }

    await client.query(
      `UPDATE users
          SET password_hash = $2,
              password_changed_at = now()
        WHERE id = $1`,
      [token.user_id, hash],
    );

    await client.query(
      `UPDATE password_reset_tokens
          SET used_at = now()
        WHERE id = $1`,
      [current.id],
    );

    await client.query(
      `UPDATE refresh_sessions
          SET revoked_at = COALESCE(revoked_at, now())
        WHERE user_id = $1`,
      [token.user_id],
    );

    return { kind: "reset" as const };
  });
}
