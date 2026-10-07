import crypto from "node:crypto";
import { pool, withTenantTransaction } from "../../db.js";
import { hashPassword } from "./identity.service.js";
import { enqueueEmail } from "../notifications/notification.service.js";
import { config } from "../../config.js";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createPasswordReset(input: {
  tenantId: string;
  email: string;
}) {
  const user = await pool.query<{ id: string }>(
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

  if (!user.rows[0]) {
    return { kind: "accepted" as const, token: undefined };
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await pool.query(
    `UPDATE password_reset_tokens
        SET used_at = now()
      WHERE user_id = $1
        AND used_at IS NULL`,
    [user.rows[0].id],
  );

  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.rows[0].id, tokenHash, expiresAt],
  );

  await withTenantTransaction(input.tenantId, async (client) => {
    await enqueueEmail(client, {
      tenantId: input.tenantId,
      recipientEmail: input.email,
      subject: "[Handoff] Recuperação de senha",
      bodyText: `Use o link ${config.APP_BASE_URL}/reset-password?token=${encodeURIComponent(token)}. O link expira em 30 minutos.`,
      dedupeKey: `password-reset:${user.rows[0]!.id}:${tokenHash}`,
    });
  });

  return { kind: "accepted" as const, token, expiresAt };
}

export async function consumePasswordReset(input: {
  token: string;
  newPassword: string;
}) {
  const tokenHash = hashToken(input.token);
  const result = await pool.query<{
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

  const current = result.rows[0];
  if (!current || current.used_at || current.expires_at.getTime() <= Date.now()) {
    return { kind: "invalid_token" as const };
  }

  const hash = await hashPassword(input.newPassword);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<{
      expires_at: Date;
      used_at: Date | null;
    }>(
      `SELECT expires_at, used_at
         FROM password_reset_tokens
        WHERE id = $1
        FOR UPDATE`,
      [current.id],
    );
    const token = locked.rows[0];
    if (!token || token.used_at || token.expires_at.getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      return { kind: "invalid_token" as const };
    }

    await client.query(
      `UPDATE users
          SET password_hash = $2, password_changed_at = now()
        WHERE id = $1`,
      [current.user_id, hash],
    );
    await client.query(
      `UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`,
      [current.id],
    );
    await client.query(
      `UPDATE refresh_sessions
          SET revoked_at = COALESCE(revoked_at, now())
        WHERE user_id = $1`,
      [current.user_id],
    );
    await client.query("COMMIT");
    return { kind: "reset" as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
