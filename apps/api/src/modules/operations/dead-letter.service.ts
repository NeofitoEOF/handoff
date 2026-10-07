import { isTenantAdmin } from "../../authorization.js";
import { withTenantTransaction } from "../../db.js";

export type DeadLetterKind = "email" | "teams" | "webhook" | "closure";

export type DeadLetterItem = {
  kind: DeadLetterKind;
  id: string;
  requestId: string | null;
  attempts: number;
  lastError: string | null;
  availableAt: Date;
  createdAt: Date;
  context: Record<string, unknown>;
};

const retryBudget: Record<DeadLetterKind, number> = {
  email: 5,
  teams: 5,
  webhook: 8,
  closure: 5,
};

export async function listDeadLetters(input: {
  tenantId: string;
  actorUserId: string;
  kind?: DeadLetterKind;
  limit: number;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await isTenantAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const kinds: DeadLetterKind[] = input.kind
      ? [input.kind]
      : ["email", "teams", "webhook", "closure"];

    const items: DeadLetterItem[] = [];

    if (kinds.includes("email")) {
      const result = await client.query<{
        id: string;
        request_id: string | null;
        recipient_email: string;
        subject: string;
        attempts: number;
        last_error: string | null;
        available_at: Date;
        created_at: Date;
      }>(
        `SELECT id, request_id, recipient_email, subject, attempts, last_error,
                available_at, created_at
           FROM email_outbox
          WHERE status = 'FAILED'
            AND attempts >= $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [retryBudget.email, input.limit],
      );

      items.push(
        ...result.rows.map((row) => ({
          kind: "email" as const,
          id: row.id,
          requestId: row.request_id,
          attempts: row.attempts,
          lastError: row.last_error,
          availableAt: row.available_at,
          createdAt: row.created_at,
          context: {
            recipientEmail: row.recipient_email,
            subject: row.subject,
          },
        })),
      );
    }

    if (kinds.includes("teams")) {
      const result = await client.query<{
        id: string;
        request_id: string | null;
        title: string;
        attempts: number;
        last_error: string | null;
        available_at: Date;
        created_at: Date;
      }>(
        `SELECT id, request_id, title, attempts, last_error, available_at, created_at
           FROM teams_outbox
          WHERE status = 'FAILED'
            AND attempts >= $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [retryBudget.teams, input.limit],
      );

      items.push(
        ...result.rows.map((row) => ({
          kind: "teams" as const,
          id: row.id,
          requestId: row.request_id,
          attempts: row.attempts,
          lastError: row.last_error,
          availableAt: row.available_at,
          createdAt: row.created_at,
          context: { title: row.title },
        })),
      );
    }

    if (kinds.includes("webhook")) {
      const result = await client.query<{
        id: string;
        event_type: string;
        event_id: string;
        attempts: number;
        last_error: string | null;
        available_at: Date;
        created_at: Date;
      }>(
        `SELECT id, event_type, event_id, attempts, last_error, available_at, created_at
           FROM webhook_outbox
          WHERE status = 'FAILED'
            AND attempts >= $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [retryBudget.webhook, input.limit],
      );

      items.push(
        ...result.rows.map((row) => ({
          kind: "webhook" as const,
          id: row.id,
          requestId: null,
          attempts: row.attempts,
          lastError: row.last_error,
          availableAt: row.available_at,
          createdAt: row.created_at,
          context: {
            eventType: row.event_type,
            eventId: row.event_id,
          },
        })),
      );
    }

    if (kinds.includes("closure")) {
      const result = await client.query<{
        id: string;
        request_id: string;
        snapshot_id: string;
        attempts: number;
        last_error: string | null;
        available_at: Date;
        created_at: Date;
      }>(
        `SELECT id, request_id, snapshot_id, attempts, last_error, available_at, created_at
           FROM closure_documents
          WHERE status = 'FAILED'
            AND attempts >= $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [retryBudget.closure, input.limit],
      );

      items.push(
        ...result.rows.map((row) => ({
          kind: "closure" as const,
          id: row.id,
          requestId: row.request_id,
          attempts: row.attempts,
          lastError: row.last_error,
          availableAt: row.available_at,
          createdAt: row.created_at,
          context: { snapshotId: row.snapshot_id },
        })),
      );
    }

    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return {
      kind: "ok" as const,
      items: items.slice(0, input.limit),
    };
  });
}

export async function retryDeadLetter(input: {
  tenantId: string;
  actorUserId: string;
  kind: DeadLetterKind;
  id: string;
  reason: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await isTenantAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const tableByKind: Record<DeadLetterKind, string> = {
      email: "email_outbox",
      teams: "teams_outbox",
      webhook: "webhook_outbox",
      closure: "closure_documents",
    };

    const table = tableByKind[input.kind];
    const maxAttempts = retryBudget[input.kind];

    const result = await client.query<{ id: string }>(
      `UPDATE ${table}
          SET status = 'PENDING',
              attempts = 0,
              available_at = now(),
              last_error = NULL,
              processing_started_at = NULL
        WHERE id = $1
          AND status = 'FAILED'
          AND attempts >= $2
       RETURNING id`,
      [input.id, maxAttempts],
    );

    if (result.rowCount !== 1) {
      return { kind: "not_found" as const };
    }

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'DEAD_LETTER_REQUEUED', 'dead_letter', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.id,
        JSON.stringify({
          queue: input.kind,
          reason: input.reason,
          attemptsResetTo: 0,
        }),
      ],
    );

    return { kind: "requeued" as const };
  });
}
