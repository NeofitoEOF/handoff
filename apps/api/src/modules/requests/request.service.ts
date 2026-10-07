import type { DbClient } from "../../db.js";
import { withTenantTransaction } from "../../db.js";
import { createInAppNotification, enqueueEmail, enqueueTeams } from "../notifications/notification.service.js";

export type ReassignRequestInput = {
  tenantId: string;
  requestId: string;
  actorUserId: string;
  newAssigneeUserId: string;
  reason:
    | "ABSENCE"
    | "TERMINATION"
    | "ROLE_CHANGE"
    | "WORKLOAD"
    | "WRONG_ASSIGNMENT"
    | "ESCALATION"
    | "OTHER";
  comment?: string;
};

type RequestRow = {
  id: string;
  assigned_to: string | null;
  status: string;
};

async function lockRequest(client: DbClient, requestId: string): Promise<RequestRow | null> {
  const result = await client.query<RequestRow>(
    `SELECT id, assigned_to, status
       FROM requests
      WHERE id = $1
      FOR UPDATE`,
    [requestId],
  );

  return result.rows[0] ?? null;
}

export async function reassignRequest(input: ReassignRequestInput) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const current = await lockRequest(client, input.requestId);

    if (!current) {
      return { kind: "not_found" as const };
    }

    if (["APPROVED", "CLOSED", "CANCELLED"].includes(current.status)) {
      return { kind: "invalid_state" as const, status: current.status };
    }

    if (current.assigned_to === input.newAssigneeUserId) {
      return { kind: "no_change" as const };
    }

    const actorPermission = await client.query(
      `SELECT 1
         FROM memberships m
         JOIN requests r ON r.destination_sector_id = m.sector_id
        WHERE r.id = $1
          AND m.user_id = $2
          AND m.role = 'MANAGER'
          AND m.active = true
        LIMIT 1`,
      [input.requestId, input.actorUserId],
    );

    if (actorPermission.rowCount !== 1) {
      return { kind: "forbidden" as const };
    }

    const membership = await client.query(
      `SELECT 1
         FROM memberships m
         JOIN requests r ON r.destination_sector_id = m.sector_id
        WHERE r.id = $1
          AND m.user_id = $2
          AND m.active = true
        LIMIT 1`,
      [input.requestId, input.newAssigneeUserId],
    );

    if (membership.rowCount !== 1) {
      return { kind: "invalid_assignee" as const };
    }

    await client.query(
      `UPDATE requests
          SET assigned_to = $2,
              status = CASE
                WHEN status = 'WAITING_REASSIGNMENT' THEN 'IN_PROGRESS'
                ELSE status
              END,
              updated_at = now()
        WHERE id = $1`,
      [input.requestId, input.newAssigneeUserId],
    );

    await client.query(
      `INSERT INTO request_assignment_history
        (tenant_id, request_id, previous_assignee_id, new_assignee_id, changed_by, reason, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.tenantId,
        input.requestId,
        current.assigned_to,
        input.newAssigneeUserId,
        input.actorUserId,
        input.reason,
        input.comment ?? null,
      ],
    );

    const newAssignee = await client.query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1 AND active = true LIMIT 1`,
      [input.newAssigneeUserId],
    );
    if (newAssignee.rows[0]) {
      await enqueueEmail(client, {
        tenantId: input.tenantId,
        requestId: input.requestId,
        recipientEmail: newAssignee.rows[0].email,
        subject: "[Handoff] Solicitação reatribuída a você",
        bodyText: "Uma solicitação foi reatribuída a você. O prazo original foi preservado.",
        dedupeKey: `request:${input.requestId}:reassigned:${input.newAssigneeUserId}:${input.reason}`,
      });
      await createInAppNotification(client, {
        tenantId: input.tenantId,
        userId: input.newAssigneeUserId,
        requestId: input.requestId,
        type: "REQUEST_REASSIGNED",
        title: "Solicitação reatribuída",
        message: "Você é o novo responsável por uma solicitação.",
      });
    }

    await enqueueTeams(client, {
      tenantId: input.tenantId,
      requestId: input.requestId,
      title: "Solicitação reatribuída",
      message: `Novo responsável definido. Motivo: ${input.reason}.`,
      dedupeKey: `request-reassigned-teams:${input.requestId}:${input.newAssigneeUserId}:${input.reason}`,
    });

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
       VALUES ($1, $2, 'REQUEST_REASSIGNED', 'request', $3, $4::jsonb, $5::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.requestId,
        JSON.stringify({ assignedTo: current.assigned_to }),
        JSON.stringify({
          assignedTo: input.newAssigneeUserId,
          reason: input.reason,
          comment: input.comment ?? null,
        }),
      ],
    );

    return {
      kind: "reassigned" as const,
      previousAssigneeUserId: current.assigned_to,
      newAssigneeUserId: input.newAssigneeUserId,
    };
  });
}
