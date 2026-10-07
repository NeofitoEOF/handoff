import crypto from "node:crypto";
import { pool } from "../../db.js";

function emailHash(email: string): string {
  return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export async function getLoginLock(input: {
  tenantId: string;
  email: string;
}) {
  const result = await pool.query<{
    attempts: number;
    window_started_at: Date;
    locked_until: Date | null;
  }>(
    `SELECT attempts, window_started_at, locked_until
       FROM login_failures
      WHERE tenant_id = $1 AND email_hash = $2
      LIMIT 1`,
    [input.tenantId, emailHash(input.email)],
  );

  const row = result.rows[0];
  if (!row?.locked_until) return { locked: false as const };
  if (row.locked_until.getTime() <= Date.now()) {
    await pool.query(
      `DELETE FROM login_failures WHERE tenant_id = $1 AND email_hash = $2`,
      [input.tenantId, emailHash(input.email)],
    );
    return { locked: false as const };
  }

  return { locked: true as const, until: row.locked_until };
}

export async function recordLoginFailure(input: {
  tenantId: string;
  email: string;
}) {
  const hash = emailHash(input.email);
  const now = new Date();
  const resetBefore = new Date(now.getTime() - 15 * 60 * 1000);

  const result = await pool.query<{
    attempts: number;
    locked_until: Date | null;
  }>(
    `INSERT INTO login_failures
      (tenant_id, email_hash, attempts, window_started_at, updated_at)
     VALUES ($1, $2, 1, now(), now())
     ON CONFLICT (tenant_id, email_hash)
     DO UPDATE SET
       attempts = CASE
         WHEN login_failures.window_started_at < $3 THEN 1
         ELSE login_failures.attempts + 1
       END,
       window_started_at = CASE
         WHEN login_failures.window_started_at < $3 THEN now()
         ELSE login_failures.window_started_at
       END,
       locked_until = CASE
         WHEN (
           CASE
             WHEN login_failures.window_started_at < $3 THEN 1
             ELSE login_failures.attempts + 1
           END
         ) >= 5 THEN now() + interval '15 minutes'
         ELSE login_failures.locked_until
       END,
       updated_at = now()
     RETURNING attempts, locked_until`,
    [input.tenantId, hash, resetBefore],
  );

  return result.rows[0]!;
}

export async function clearLoginFailures(input: {
  tenantId: string;
  email: string;
}) {
  await pool.query(
    `DELETE FROM login_failures WHERE tenant_id = $1 AND email_hash = $2`,
    [input.tenantId, emailHash(input.email)],
  );
}
