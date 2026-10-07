import { withTenantTransaction } from "../../db.js";

async function canManageOrigin(
  client: import("../../db.js").DbClient,
  requestId: string,
  actorUserId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM requests r
       LEFT JOIN memberships m
         ON m.sector_id = r.origin_sector_id
        AND m.user_id = $2
        AND m.active = true
        AND m.role IN ('MANAGER', 'APPROVER')
      WHERE r.id = $1
        AND (r.created_by = $2 OR m.id IS NOT NULL)
      LIMIT 1`,
    [requestId, actorUserId],
  );
  return result.rowCount === 1;
}

export async function changeRequestDueDate(input: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
  newDueAt: Date;
  reason: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const result = await client.query<{ due_at: Date; status: string }>(
      `SELECT due_at, status FROM requests WHERE id = $1 FOR UPDATE`,
      [input.requestId],
    );
    const current = result.rows[0];
    if (!current) return { kind: "not_found" as const };

    if (["APPROVED", "CLOSED", "CANCELLED"].includes(current.status)) {
      return { kind: "invalid_state" as const, status: current.status };
    }
    if (!(await canManageOrigin(client, input.requestId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }
    if (input.newDueAt.getTime() <= Date.now()) {
      return { kind: "invalid_due_date" as const };
    }

    await client.query(
      `UPDATE requests SET due_at = $2, updated_at = now() WHERE id = $1`,
      [input.requestId, input.newDueAt],
    );
    await client.query(
      `INSERT INTO request_due_date_history
        (tenant_id, request_id, previous_due_at, new_due_at, changed_by, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.tenantId, input.requestId, current.due_at, input.newDueAt, input.actorUserId, input.reason],
    );
    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
       VALUES ($1, $2, 'REQUEST_DUE_DATE_CHANGED', 'request', $3, $4::jsonb, $5::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.requestId,
        JSON.stringify({ dueAt: current.due_at }),
        JSON.stringify({ dueAt: input.newDueAt, reason: input.reason }),
      ],
    );

    return { kind: "changed" as const };
  });
}

export async function cancelRequest(input: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
  reason: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const result = await client.query<{ status: string }>(
      `SELECT status FROM requests WHERE id = $1 FOR UPDATE`,
      [input.requestId],
    );
    const current = result.rows[0];
    if (!current) return { kind: "not_found" as const };

    if (["APPROVED", "CLOSED", "CANCELLED"].includes(current.status)) {
      return { kind: "invalid_state" as const, status: current.status };
    }
    if (!(await canManageOrigin(client, input.requestId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    await client.query(
      `UPDATE requests
          SET status = 'CANCELLED', updated_at = now()
        WHERE id = $1`,
      [input.requestId],
    );
    await client.query(
      `INSERT INTO request_cancellations
        (tenant_id, request_id, cancelled_by, reason)
       VALUES ($1, $2, $3, $4)`,
      [input.tenantId, input.requestId, input.actorUserId, input.reason],
    );
    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
       VALUES ($1, $2, 'REQUEST_CANCELLED', 'request', $3, $4::jsonb, $5::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.requestId,
        JSON.stringify({ status: current.status }),
        JSON.stringify({ status: "CANCELLED", reason: input.reason }),
      ],
    );

    return { kind: "cancelled" as const };
  });
}
