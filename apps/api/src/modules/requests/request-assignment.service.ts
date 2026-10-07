import { withTenantTransaction } from "../../db.js";
import { isSectorManager } from "../../authorization.js";
import { createInAppNotification, enqueueEmail, enqueueTeams } from "../notifications/notification.service.js";

export async function assignRequest(input: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
  assigneeUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const requestResult = await client.query<{
      id: string;
      destination_sector_id: string;
      assigned_to: string | null;
      status: string;
    }>(
      `SELECT id, destination_sector_id, assigned_to, status
         FROM requests
        WHERE id = $1
        FOR UPDATE`,
      [input.requestId],
    );

    const current = requestResult.rows[0];
    if (!current) return { kind: "not_found" as const };

    if (!["OPEN", "WAITING_REASSIGNMENT"].includes(current.status)) {
      return { kind: "invalid_state" as const, status: current.status };
    }

    if (!(await isSectorManager(client, current.destination_sector_id, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const assignee = await client.query(
      `SELECT 1
         FROM memberships
        WHERE sector_id = $1
          AND user_id = $2
          AND active = true
        LIMIT 1`,
      [current.destination_sector_id, input.assigneeUserId],
    );

    if (assignee.rowCount !== 1) {
      return { kind: "invalid_assignee" as const };
    }

    await client.query(
      `UPDATE requests
          SET assigned_to = $2,
              status = 'IN_PROGRESS',
              updated_at = now()
        WHERE id = $1`,
      [input.requestId, input.assigneeUserId],
    );

    await client.query(
      `INSERT INTO request_assignment_history
        (tenant_id, request_id, previous_assignee_id, new_assignee_id, changed_by, reason)
       VALUES ($1, $2, $3, $4, $5, 'INITIAL_ASSIGNMENT')`,
      [
        input.tenantId,
        input.requestId,
        current.assigned_to,
        input.assigneeUserId,
        input.actorUserId,
      ],
    );

    const assigneeUser = await client.query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1 AND active = true LIMIT 1`,
      [input.assigneeUserId],
    );
    if (assigneeUser.rows[0]) {
      await enqueueEmail(client, {
        tenantId: input.tenantId,
        requestId: input.requestId,
        recipientEmail: assigneeUser.rows[0].email,
        subject: "[Handoff] Solicitação atribuída a você",
        bodyText: "Uma solicitação foi atribuída a você. Acesse o Handoff para visualizar o prazo e responder.",
        dedupeKey: `request:${input.requestId}:assigned:${input.assigneeUserId}`,
      });
      await createInAppNotification(client, {
        tenantId: input.tenantId,
        userId: input.assigneeUserId,
        requestId: input.requestId,
        type: "REQUEST_ASSIGNED",
        title: "Solicitação atribuída",
        message: "Uma solicitação foi atribuída a você.",
      });
    }

    await enqueueTeams(client, {
      tenantId: input.tenantId,
      requestId: input.requestId,
      title: "Responsável atribuído",
      message: "Uma solicitação recebeu responsável no setor de destino.",
      dedupeKey: `request-assigned-teams:${input.requestId}:${input.assigneeUserId}`,
    });

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
       VALUES ($1, $2, 'REQUEST_ASSIGNED', 'request', $3, $4::jsonb, $5::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.requestId,
        JSON.stringify({ assignedTo: current.assigned_to, status: current.status }),
        JSON.stringify({ assignedTo: input.assigneeUserId, status: "IN_PROGRESS" }),
      ],
    );

    return { kind: "assigned" as const, assigneeUserId: input.assigneeUserId };
  });
}
