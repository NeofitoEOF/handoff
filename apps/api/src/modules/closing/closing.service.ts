import { withTenantTransaction } from "../../db.js";

async function canClose(
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

export async function closeRequest(input: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const requestResult = await client.query<{
      id: string;
      status: string;
      origin_sector_id: string;
      destination_sector_id: string;
      title: string;
      due_at: Date;
      competence: string | null;
      template_version_id: string | null;
      retifies_request_id: string | null;
    }>(
      `SELECT id, status, origin_sector_id, destination_sector_id, title, due_at,
              competence, template_version_id, retifies_request_id
         FROM requests
        WHERE id = $1
        FOR UPDATE`,
      [input.requestId],
    );

    const request = requestResult.rows[0];
    if (!request) return { kind: "not_found" as const };
    if (request.status !== "APPROVED") {
      return { kind: "invalid_state" as const, status: request.status };
    }
    if (!(await canClose(client, input.requestId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const items = await client.query(
      `SELECT id, item_key, data, status, submitted_by, submitted_at, reviewed_by, reviewed_at
         FROM request_items
        WHERE request_id = $1
        ORDER BY created_at, item_key`,
      [input.requestId],
    );

    const snapshotContent = {
      request,
      items: items.rows,
      closedBy: input.actorUserId,
      closedAt: new Date().toISOString(),
    };

    const snapshot = await client.query<{ id: string; sha256: string }>(
      `INSERT INTO snapshots (tenant_id, request_id, content, sha256, created_by)
       VALUES (
         $1, $2, $3::jsonb,
         encode(digest(convert_to($4, 'UTF8'), 'sha256'), 'hex'),
         $5
       )
       RETURNING id, sha256`,
      [
        input.tenantId,
        input.requestId,
        JSON.stringify(snapshotContent),
        JSON.stringify(snapshotContent),
        input.actorUserId,
      ],
    );

    await client.query(
      `UPDATE requests SET status = 'CLOSED', updated_at = now() WHERE id = $1`,
      [input.requestId],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'REQUEST_CLOSED', 'request', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.requestId,
        JSON.stringify({ status: "CLOSED", snapshotId: snapshot.rows[0]!.id, sha256: snapshot.rows[0]!.sha256 }),
      ],
    );

    return { kind: "closed" as const, snapshot: snapshot.rows[0] };
  });
}

export async function createRetification(input: {
  tenantId: string;
  originalRequestId: string;
  actorUserId: string;
  dueAt: Date;
  reason: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const originalResult = await client.query<{
      id: string;
      status: string;
      origin_sector_id: string;
      destination_sector_id: string;
      title: string;
      competence: string | null;
      instructions: string | null;
      template_version_id: string | null;
    }>(
      `SELECT id, status, origin_sector_id, destination_sector_id, title, competence,
              instructions, template_version_id
         FROM requests
        WHERE id = $1
        FOR UPDATE`,
      [input.originalRequestId],
    );

    const original = originalResult.rows[0];
    if (!original) return { kind: "not_found" as const };
    if (original.status !== "CLOSED") return { kind: "invalid_state" as const, status: original.status };

    const permission = await client.query(
      `SELECT 1
         FROM memberships
        WHERE sector_id = $1
          AND user_id = $2
          AND active = true
          AND role IN ('MANAGER', 'APPROVER')
        LIMIT 1`,
      [original.origin_sector_id, input.actorUserId],
    );
    if (permission.rowCount !== 1) return { kind: "forbidden" as const };

    const activeRetification = await client.query(
      `SELECT 1
         FROM requests
        WHERE retifies_request_id = $1
          AND status NOT IN ('CLOSED', 'CANCELLED')
        LIMIT 1`,
      [input.originalRequestId],
    );
    if (activeRetification.rowCount === 1) return { kind: "already_active" as const };

    const created = await client.query(
      `INSERT INTO requests
        (tenant_id, origin_sector_id, destination_sector_id, created_by, title, due_at,
         status, competence, instructions, template_version_id, retifies_request_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $8, $9, $10)
       RETURNING id, title, due_at, status, retifies_request_id`,
      [
        input.tenantId,
        original.origin_sector_id,
        original.destination_sector_id,
        input.actorUserId,
        `Retificação: ${original.title}`,
        input.dueAt,
        original.competence,
        `${original.instructions ?? ""}\n\nMotivo da retificação: ${input.reason}`.trim(),
        original.template_version_id,
        original.id,
      ],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'REQUEST_RETIFICATION_CREATED', 'request', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        created.rows[0].id,
        JSON.stringify({ retifiesRequestId: original.id, reason: input.reason }),
      ],
    );

    return { kind: "created" as const, request: created.rows[0] };
  });
}
