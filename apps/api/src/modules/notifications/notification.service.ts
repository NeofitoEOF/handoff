import type { DbClient } from "../../db.js";
import { withTenantTransaction } from "../../db.js";

export async function enqueueEmail(
  client: DbClient,
  input: {
    tenantId: string;
    requestId?: string;
    recipientEmail: string;
    subject: string;
    bodyText: string;
    dedupeKey: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO email_outbox
      (tenant_id, request_id, recipient_email, subject, body_text, dedupe_key)
     VALUES ($1, $2, lower($3), $4, $5, $6)
     ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
    [
      input.tenantId,
      input.requestId ?? null,
      input.recipientEmail,
      input.subject,
      input.bodyText,
      input.dedupeKey,
    ],
  );
}

export async function createInAppNotification(
  client: DbClient,
  input: {
    tenantId: string;
    userId: string;
    requestId?: string;
    type: string;
    title: string;
    message: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO notifications
      (tenant_id, user_id, request_id, type, title, message)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.tenantId,
      input.userId,
      input.requestId ?? null,
      input.type,
      input.title,
      input.message,
    ],
  );
}

export async function listNotifications(input: {
  tenantId: string;
  userId: string;
  unreadOnly?: boolean;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const result = await client.query(
      `SELECT id, request_id, type, title, message, read_at, created_at
         FROM notifications
        WHERE user_id = $1
          AND ($2::boolean = false OR read_at IS NULL)
        ORDER BY created_at DESC
        LIMIT 100`,
      [input.userId, input.unreadOnly ?? false],
    );
    return result.rows;
  });
}

export async function markNotificationRead(input: {
  tenantId: string;
  userId: string;
  notificationId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const result = await client.query(
      `UPDATE notifications
          SET read_at = COALESCE(read_at, now())
        WHERE id = $1 AND user_id = $2
       RETURNING id, read_at`,
      [input.notificationId, input.userId],
    );
    return result.rows[0] ?? null;
  });
}
