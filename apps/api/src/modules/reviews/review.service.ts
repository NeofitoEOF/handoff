import { withTenantTransaction } from "../../db.js";

async function canReview(
  client: import("../../db.js").DbClient,
  requestId: string,
  actorUserId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM requests r
       JOIN memberships m
         ON m.sector_id = r.origin_sector_id
        AND m.user_id = $2
        AND m.active = true
        AND m.role IN ('MANAGER', 'APPROVER')
      WHERE r.id = $1
      LIMIT 1`,
    [requestId, actorUserId],
  );
  return result.rowCount === 1;
}

async function recalculateRequestStatus(
  client: import("../../db.js").DbClient,
  requestId: string,
): Promise<string> {
  const counts = await client.query<{
    total: string;
    approved: string;
    returned: string;
    submitted: string;
  }>(
    `SELECT
       count(*)::text AS total,
       count(*) FILTER (WHERE status = 'APPROVED')::text AS approved,
       count(*) FILTER (WHERE status = 'RETURNED')::text AS returned,
       count(*) FILTER (WHERE status = 'SUBMITTED')::text AS submitted
     FROM request_items
     WHERE request_id = $1`,
    [requestId],
  );

  const row = counts.rows[0]!;
  const total = Number(row.total);
  const approved = Number(row.approved);
  const returned = Number(row.returned);
  const submitted = Number(row.submitted);

  const nextStatus =
    total > 0 && approved === total
      ? "APPROVED"
      : returned > 0
        ? "IN_CORRECTION"
        : submitted > 0
          ? "IN_REVIEW"
          : "IN_PROGRESS";

  await client.query(
    `UPDATE requests SET status = $2::request_status, updated_at = now() WHERE id = $1`,
    [requestId, nextStatus],
  );

  return nextStatus;
}

export async function approveItem(input: {
  tenantId: string;
  requestId: string;
  itemId: string;
  actorUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await canReview(client, input.requestId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const itemResult = await client.query<{
      id: string;
      status: string;
      submitted_by: string | null;
    }>(
      `SELECT id, status, submitted_by
         FROM request_items
        WHERE id = $1 AND request_id = $2
        FOR UPDATE`,
      [input.itemId, input.requestId],
    );

    const item = itemResult.rows[0];
    if (!item) return { kind: "not_found" as const };
    if (item.status !== "SUBMITTED") return { kind: "invalid_state" as const, status: item.status };
    if (item.submitted_by === input.actorUserId) return { kind: "maker_checker" as const };

    await client.query(
      `UPDATE request_items
          SET status = 'APPROVED',
              reviewed_by = $2,
              reviewed_at = now(),
              return_comment = NULL,
              correction_due_at = NULL,
              updated_at = now()
        WHERE id = $1`,
      [input.itemId, input.actorUserId],
    );

    const requestStatus = await recalculateRequestStatus(client, input.requestId);

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'REQUEST_ITEM_APPROVED', 'request_item', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.itemId,
        JSON.stringify({ status: "APPROVED", requestStatus }),
      ],
    );

    return { kind: "approved" as const, requestStatus };
  });
}

export async function returnItem(input: {
  tenantId: string;
  requestId: string;
  itemId: string;
  actorUserId: string;
  comment: string;
  correctionDueAt: Date;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await canReview(client, input.requestId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }
    if (input.correctionDueAt.getTime() <= Date.now()) {
      return { kind: "invalid_due_date" as const };
    }

    const itemResult = await client.query<{
      id: string;
      status: string;
      submitted_by: string | null;
    }>(
      `SELECT id, status, submitted_by
         FROM request_items
        WHERE id = $1 AND request_id = $2
        FOR UPDATE`,
      [input.itemId, input.requestId],
    );

    const item = itemResult.rows[0];
    if (!item) return { kind: "not_found" as const };
    if (item.status !== "SUBMITTED") return { kind: "invalid_state" as const, status: item.status };
    if (item.submitted_by === input.actorUserId) return { kind: "maker_checker" as const };

    await client.query(
      `UPDATE request_items
          SET status = 'RETURNED',
              reviewed_by = $2,
              reviewed_at = now(),
              return_comment = $3,
              correction_due_at = $4,
              updated_at = now()
        WHERE id = $1`,
      [input.itemId, input.actorUserId, input.comment, input.correctionDueAt],
    );

    const requestStatus = await recalculateRequestStatus(client, input.requestId);

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'REQUEST_ITEM_RETURNED', 'request_item', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.itemId,
        JSON.stringify({
          status: "RETURNED",
          comment: input.comment,
          correctionDueAt: input.correctionDueAt,
          requestStatus,
        }),
      ],
    );

    return { kind: "returned" as const, requestStatus };
  });
}
