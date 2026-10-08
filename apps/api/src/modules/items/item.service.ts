import { withTenantTransaction } from "../../db.js";
import {
  canSeeField,
  prepareItemData,
  readApprovalPolicy,
  readSchemaFields,
  redactData,
  requiredApprovals,
} from "../templates/field-access.js";
import { loadFieldViewer } from "../templates/field-viewer.js";

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

    const schemaRow = await client.query<{
      schema_json: unknown;
      origin_sector_id: string;
    }>(
      `SELECT tv.schema_json, r.origin_sector_id
         FROM requests r
         LEFT JOIN template_versions tv ON tv.id = r.template_version_id
        WHERE r.id = $1`,
      [input.requestId],
    );
    const fields = readSchemaFields(schemaRow.rows[0]?.schema_json);
    const viewer = await loadFieldViewer(client, input.actorUserId, [
      schemaRow.rows[0]?.origin_sector_id ?? permission.request.destination_sector_id,
      permission.request.destination_sector_id,
    ]);
    const existing = await client.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM request_items
        WHERE tenant_id = $1 AND request_id = $2 AND item_key = $3`,
      [input.tenantId, input.requestId, input.itemKey],
    );
    const prepared = prepareItemData({
      existing: existing.rows[0]?.data ?? {},
      incoming: input.data,
      fields,
      viewer,
    });
    if (!prepared.ok) return { kind: "field_locked" as const, fields: prepared.fields };

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
      [input.tenantId, input.requestId, input.itemKey, JSON.stringify(prepared.data), input.actorUserId],
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

    const saved = result.rows[0] as {
      id: string;
      item_key: string;
      data: Record<string, unknown>;
      status: string;
      updated_at: Date;
    };
    return {
      kind: "saved" as const,
      item: { ...saved, data: redactData(saved.data, fields, viewer) },
    };
  });
}

export async function listRequestItems(input: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const request = await client.query<{
      origin_sector_id: string;
      destination_sector_id: string;
      schema_json: unknown;
    }>(
      `SELECT r.origin_sector_id, r.destination_sector_id, tv.schema_json
         FROM requests r
         LEFT JOIN template_versions tv ON tv.id = r.template_version_id
        WHERE r.id = $1`,
      [input.requestId],
    );
    const current = request.rows[0];
    if (!current) return { kind: "not_found" as const };

    const viewer = await loadFieldViewer(client, input.actorUserId, [
      current.origin_sector_id,
      current.destination_sector_id,
    ]);
    if (!viewer.privileged && viewer.roles.length === 0) return { kind: "forbidden" as const };

    const fields = readSchemaFields(current.schema_json);
    const policy = readApprovalPolicy(current.schema_json);
    const policyField = policy ? fields.find((field) => field.key === policy.fieldKey) : undefined;
    const revealThreshold = !!policy && (
      viewer.privileged
      || viewer.roles.some((role) => role === "MANAGER" || role === "APPROVER")
      || (!!policyField && canSeeField(policyField, viewer))
    );
    const items = await client.query<{
      id: string;
      item_key: string;
      data: Record<string, unknown>;
      status: string;
      last_edited_by: string | null;
      submitted_by: string | null;
      submitted_at: Date | null;
      reviewed_by: string | null;
      reviewed_at: Date | null;
      return_comment: string | null;
      correction_due_at: Date | null;
      updated_at: Date;
      approval_count: number;
    }>(
      `SELECT i.id, i.item_key, i.data, i.status, i.last_edited_by, i.submitted_by, i.submitted_at,
              i.reviewed_by, i.reviewed_at, i.return_comment, i.correction_due_at, i.updated_at,
              (SELECT count(*)::int FROM request_item_approvals a WHERE a.request_item_id = i.id) AS approval_count
         FROM request_items i
        WHERE i.request_id = $1
        ORDER BY i.created_at, i.item_key`,
      [input.requestId],
    );

    return {
      kind: "ok" as const,
      items: items.rows.map((item) => ({
        ...item,
        data: redactData(item.data, fields, viewer),
        approval_count: revealThreshold ? item.approval_count : 0,
        approvals_required: revealThreshold ? requiredApprovals(policy, item.data) : 1,
      })),
    };
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
