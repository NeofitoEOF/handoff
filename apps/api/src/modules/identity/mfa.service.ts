import { pool, withTenantTransaction } from "../../db.js";
import {
  buildOtpAuthUri,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  verifyTotp,
} from "./totp.js";

export async function setupMfa(input: {
  tenantId: string;
  userId: string;
}) {
  const user = await pool.query<{ email: string }>(
    `SELECT email FROM users WHERE id = $1 AND active = true LIMIT 1`,
    [input.userId],
  );
  const current = user.rows[0];
  if (!current) return { kind: "not_found" as const };

  const secret = generateTotpSecret();
  const encrypted = encryptSecret(secret);

  await withTenantTransaction(input.tenantId, async (client) => {
    await client.query(
      `INSERT INTO user_mfa
        (user_id, secret_ciphertext, secret_iv, secret_tag, enabled, updated_at)
       VALUES ($1, $2, $3, $4, false, now())
       ON CONFLICT (user_id)
       DO UPDATE SET
         secret_ciphertext = EXCLUDED.secret_ciphertext,
         secret_iv = EXCLUDED.secret_iv,
         secret_tag = EXCLUDED.secret_tag,
         enabled = false,
         enabled_at = NULL,
         updated_at = now()`,
      [input.userId, encrypted.ciphertext, encrypted.iv, encrypted.tag],
    );
  });

  return {
    kind: "created" as const,
    secret,
    otpauthUri: buildOtpAuthUri({ email: current.email, secret }),
  };
}

export async function confirmMfa(input: {
  tenantId: string;
  userId: string;
  token: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const result = await client.query<{
      secret_ciphertext: string;
      secret_iv: string;
      secret_tag: string;
    }>(
      `SELECT secret_ciphertext, secret_iv, secret_tag
         FROM user_mfa
        WHERE user_id = $1
        FOR UPDATE`,
      [input.userId],
    );

    const row = result.rows[0];
    if (!row) return { kind: "not_setup" as const };

    const secret = decryptSecret({
      ciphertext: row.secret_ciphertext,
      iv: row.secret_iv,
      tag: row.secret_tag,
    });

    if (!verifyTotp(secret, input.token)) return { kind: "invalid_token" as const };

    await client.query(
      `UPDATE user_mfa
          SET enabled = true, enabled_at = now(), updated_at = now()
        WHERE user_id = $1`,
      [input.userId],
    );

    return { kind: "enabled" as const };
  });
}

export async function disableMfa(input: {
  tenantId: string;
  userId: string;
  token: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const result = await client.query<{
      secret_ciphertext: string;
      secret_iv: string;
      secret_tag: string;
      enabled: boolean;
    }>(
      `SELECT secret_ciphertext, secret_iv, secret_tag, enabled
         FROM user_mfa
        WHERE user_id = $1
        FOR UPDATE`,
      [input.userId],
    );

    const row = result.rows[0];
    if (!row || !row.enabled) return { kind: "not_enabled" as const };

    const secret = decryptSecret({
      ciphertext: row.secret_ciphertext,
      iv: row.secret_iv,
      tag: row.secret_tag,
    });
    if (!verifyTotp(secret, input.token)) return { kind: "invalid_token" as const };

    await client.query(`DELETE FROM user_mfa WHERE user_id = $1`, [input.userId]);
    return { kind: "disabled" as const };
  });
}

export async function verifyMfaForLogin(userId: string, token: string | undefined) {
  const result = await pool.query<{
    secret_ciphertext: string;
    secret_iv: string;
    secret_tag: string;
    enabled: boolean;
  }>(
    `SELECT secret_ciphertext, secret_iv, secret_tag, enabled
       FROM user_mfa
      WHERE user_id = $1
      LIMIT 1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row || !row.enabled) return { kind: "not_required" as const };
  if (!token) return { kind: "required" as const };

  const secret = decryptSecret({
    ciphertext: row.secret_ciphertext,
    iv: row.secret_iv,
    tag: row.secret_tag,
  });
  return verifyTotp(secret, token)
    ? { kind: "valid" as const }
    : { kind: "invalid" as const };
}
