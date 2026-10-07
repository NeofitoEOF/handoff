import { withTenantTransaction } from "../../db.js";

async function loadEditableRequest(
  client: import("../../db.js").DbClient,
  requestId: string,
  actorUserId: string,
) {
  const result = await client.query<{
    id: string;
    status: string;
    assigned_to: string | null;
    destination_sector_id: string;
  }>(
    `SELECT id, status, assigned_to, destination_sector_id
       FROM requests
      WHERE id = $1
      FOR UPDATE`,
    [requestId],
  );

  const request = result.rows[0];
  if (!request) return { kind: "not_found" as const };

  if (!["IN_PROGRESS", "IN_CORRECTION"].includes(request.status)) {
    return { kind: "invalid_state" as const, status: request.status };
  }

  const membership = await client.query(
    `SELECT 1
       FROM memberships
      WHERE sector_id = $1
        AND user_id = $2
        AND active = true
      LIMIT 1`,
    [request.destination_sector_id, actorUserId],
  );

  if (membership.rowCount !== 1) {
    return { kind: "forbidden" as const };
  }

  if (request.assigned_to && request.assigned_to !== actorUserId) {
    return { kind: "not_assignee" as const };
  }

  return { kind: "ok" as const, request };
}

export async function upsertRequestItem(input: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
  itemKey: string;
  data: Record<string, unknown>;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const permission = await loadEditableRequest(client, input.requestId, input.actorUserId);
    if (permission.kind !== "ok") return permission;

    const result = await client.query(
      `INSERT INTO request_items
        (tenant_id, request_id, item_key, data, status, last_edited_by)
       VALUES ($1, $2, $3, $4::jsonb, 'DRAFT', $5)
       ON CONFLICT (tenant_id, request_id, item_key)
       DO UPDATE SET
         data = EXCLUDED.data,
         last_edited_by = EXCLUDED.last_edited_by,
         status = CASE
           WHEN request_items.status = 'RETURNED' THEN 'DRAFT'
           ELSE request_items.status
         END,
         updated_at = now()
       WHERE request_items.status IN ('DRAFT', 'RETURNED')
       RETURNING id, item_key, data, status, updated_at`,
      [input.tenantId, input.requestId, input.itemKey, JSON.stringify(input.data), input.actorUserId],
    );

    if (result.rowCount !== 1) {
      return { kind: "item_locked" as const };
    }

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'REQUEST_ITEM_SAVED', 'request_item', $3, $4::jsonb)`,
      [input.tenantId, input.actorUserId, result.rows[0].id, JSON.stringify(result.rows[0])],
    );

    return { kind: "saved" as const, item: result.rows[0] };
  });
}

export async function listRequestItems(input: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const request = await client.query<{ origin_sector_id: string; destination_sector_id: string }>(
      `SELECT origin_sector_id, destination_sector_id FROM requests WHERE id = $1`,
      [input.requestId],
    );
    const current = request.rows[0];
    if (!current) return { kind: "not_found" as const };

    const access = await client.query(
      `SELECT 1
         FROM memberships
        WHERE user_id = $1
          AND sector_id = ANY($2::uuid[])
          AND active = true
        LIMIT 1`,
      [input.actorUserId, [current.origin_sector_id, current.destination_sector_id]],
    );
    if (access.rowCount !== 1) return { kind: "forbidden" as const };

    const items = await client.query(
      `SELECT id, item_key, data, status, last_edited_by, submitted_by, submitted_at,
              reviewed_by, reviewed_at, return_comment, correction_due_at, updated_at
         FROM request_items
        WHERE request_id = $1
        ORDER BY created_at, item_key`,
      [input.requestId],
    );

    return { kind: "ok" as const, items: items.rows };
  });
}

export async function submitRequestItems(input: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const permission = await loadEditableRequest(client, input.requestId, input.actorUserId);
    if (permission.kind !== "ok") return permission;

    const draftCount = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM request_items
        WHERE request_id = $1
          AND status IN ('DRAFT', 'RETURNED')`,
      [input.requestId],
    );

    if (Number(draftCount.rows[0]?.count ?? 0) === 0) {
      return { kind: "nothing_to_submit" as const };
    }

    await client.query(
      `UPDATE request_items
          SET status = 'SUBMITTED',
              submitted_by = $2,
              submitted_at = now(),
              return_comment = NULL,
              correction_due_at = NULL,
              updated_at = now()
        WHERE request_id = $1
          AND status IN ('DRAFT', 'RETURNED')`,
      [input.requestId, input.actorUserId],
    );

    await client.query(
      `UPDATE requests
          SET status = 'IN_REVIEW', updated_at = now()
        WHERE id = $1`,
      [input.requestId],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'REQUEST_SUBMITTED', 'request', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.requestId,
        JSON.stringify({ status: "IN_REVIEW" }),
      ],
    );

    return { kind: "submitted" as const };
  });
}
