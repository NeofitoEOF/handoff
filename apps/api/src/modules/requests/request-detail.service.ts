import { withTenantTransaction } from "../../db.js";
import { calculateColumnTotals } from "../templates/calculations.js";

export async function getRequestDetail(input: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const result = await client.query<{
      id: string;
      title: string;
      instructions: string | null;
      competence: string | null;
      due_at: Date;
      status: string;
      origin_sector_id: string;
      origin_sector_name: string;
      destination_sector_id: string;
      destination_sector_name: string;
      assigned_to: string | null;
      assignee_name: string | null;
      created_by: string;
      template_version_id: string | null;
      schema_json: unknown | null;
      retifies_request_id: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT
          r.id, r.title, r.instructions, r.competence, r.due_at, r.status,
          r.origin_sector_id, so.name AS origin_sector_name,
          r.destination_sector_id, sd.name AS destination_sector_name,
          r.assigned_to, au.name AS assignee_name,
          r.created_by, r.template_version_id, tv.schema_json,
          r.retifies_request_id, r.created_at, r.updated_at
       FROM requests r
       JOIN sectors so ON so.id = r.origin_sector_id
       JOIN sectors sd ON sd.id = r.destination_sector_id
       LEFT JOIN users au ON au.id = r.assigned_to
       LEFT JOIN template_versions tv ON tv.id = r.template_version_id
      WHERE r.id = $1`,
      [input.requestId],
    );

    const request = result.rows[0];
    if (!request) return { kind: "not_found" as const };

    const roles = await client.query<{
      sector_id: string;
      role: "MANAGER" | "APPROVER" | "MEMBER";
    }>(
      `SELECT sector_id, role
         FROM memberships
        WHERE user_id = $1
          AND active = true
          AND sector_id = ANY($2::uuid[])`,
      [input.actorUserId, [request.origin_sector_id, request.destination_sector_id]],
    );

    const tenantRole = await client.query<{ role: "ADMIN" | "AUDITOR" | "USER" }>(
      `SELECT role
         FROM tenant_users
        WHERE tenant_id = $1 AND user_id = $2 AND active = true
        LIMIT 1`,
      [input.tenantId, input.actorUserId],
    );

    const originRole = roles.rows.find((x) => x.sector_id === request.origin_sector_id)?.role;
    const destinationRole = roles.rows.find((x) => x.sector_id === request.destination_sector_id)?.role;
    const globalRole = tenantRole.rows[0]?.role;

    if (!originRole && !destinationRole && !["ADMIN", "AUDITOR"].includes(globalRole ?? "")) {
      return { kind: "not_found" as const };
    }

    const editableStatuses = ["IN_PROGRESS", "IN_CORRECTION"];
    const reviewableStatuses = ["IN_REVIEW"];
    const terminal = ["CLOSED", "CANCELLED"];

    const itemRows = await client.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM request_items WHERE request_id = $1 ORDER BY created_at, item_key`,
      [input.requestId],
    );
    const schemaFields =
      request.schema_json &&
      typeof request.schema_json === "object" &&
      "fields" in (request.schema_json as Record<string, unknown>) &&
      Array.isArray((request.schema_json as { fields?: unknown }).fields)
        ? ((request.schema_json as { fields: Array<{ key: string; calculation?: unknown }> }).fields)
        : [];
    const computedTotals = calculateColumnTotals(
      itemRows.rows.map((row) => row.data),
      schemaFields as any,
    );

    return {
      kind: "ok" as const,
      request,
      computedTotals,
      permissions: {
        canRead: true,
        canEdit:
          !!destinationRole &&
          editableStatuses.includes(request.status) &&
          (!request.assigned_to || request.assigned_to === input.actorUserId),
        canSubmit:
          !!destinationRole &&
          editableStatuses.includes(request.status) &&
          (!request.assigned_to || request.assigned_to === input.actorUserId),
        canReview:
          !!originRole &&
          ["MANAGER", "APPROVER"].includes(originRole) &&
          reviewableStatuses.includes(request.status),
        canAssign:
          destinationRole === "MANAGER" &&
          ["OPEN", "WAITING_REASSIGNMENT"].includes(request.status),
        canReassign:
          destinationRole === "MANAGER" &&
          !["APPROVED", "CLOSED", "CANCELLED"].includes(request.status),
        canCancel:
          !!originRole &&
          (request.created_by === input.actorUserId || ["MANAGER", "APPROVER"].includes(originRole)) &&
          !terminal.includes(request.status),
        canClose:
          !!originRole &&
          ["MANAGER", "APPROVER"].includes(originRole) &&
          request.status === "APPROVED",
        canRetify:
          !!originRole &&
          ["MANAGER", "APPROVER"].includes(originRole) &&
          request.status === "CLOSED",
        canAudit: !!originRole || !!destinationRole || globalRole === "ADMIN" || globalRole === "AUDITOR",
      },
    };
  });
}
