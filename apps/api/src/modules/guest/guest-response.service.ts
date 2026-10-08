import { withTenantTransaction } from "../../db.js";
import { withGuestSession } from "./guest.service.js";
import {
  prepareItemData,
  presentFields,
  readApprovalPolicy,
  readSchemaFields,
  redactData,
} from "../templates/field-access.js";
import { guestFieldViewer } from "../templates/field-viewer.js";

export async function getGuestRequest(sessionToken: string) {
  return withGuestSession(sessionToken, async (context) => {
    return withTenantTransaction(context.tenantId, async (client) => {
      const request = await client.query(
        `SELECT r.id, r.title, r.instructions, r.due_at, r.status, r.competence,
                so.name AS origin_sector_name,
                sd.name AS destination_sector_name,
                tv.schema_json
           FROM requests r
           JOIN sectors so ON so.id = r.origin_sector_id
           JOIN sectors sd ON sd.id = r.destination_sector_id
           LEFT JOIN template_versions tv ON tv.id = r.template_version_id
          WHERE r.id = $1`,
        [context.requestId],
      );

      const items = await client.query<{
        id: string;
        item_key: string;
        data: Record<string, unknown>;
        status: string;
        return_comment: string | null;
        correction_due_at: Date | null;
        updated_at: Date;
      }>(
        `SELECT id, item_key, data, status, return_comment, correction_due_at, updated_at
           FROM request_items
          WHERE request_id = $1
          ORDER BY created_at, item_key`,
        [context.requestId],
      );
      const currentRequest = request.rows[0] as { schema_json?: unknown } | undefined;
      const fields = readSchemaFields(currentRequest?.schema_json);
      const visibleFields = presentFields(fields, guestFieldViewer);
      const policy = readApprovalPolicy(currentRequest?.schema_json);
      if (currentRequest) {
        currentRequest.schema_json = {
          fields: visibleFields,
          ...(policy && visibleFields.some((field) => field.key === policy.fieldKey)
            ? { approvalPolicy: policy }
            : {}),
        };
      }

      return {
        kind: "ok" as const,
        request: currentRequest,
        items: items.rows.map((item) => ({
          ...item,
          data: redactData(item.data, fields, guestFieldViewer),
        })),
        guestEmail: context.email,
      };
    });
  });
}

export async function saveGuestItem(input: {
  sessionToken: string;
  itemKey: string;
  data: Record<string, unknown>;
}) {
  return withGuestSession(input.sessionToken, async (context) => {
    return withTenantTransaction(context.tenantId, async (client) => {
      const request = await client.query<{ status: string }>(
        `SELECT status FROM requests WHERE id = $1 FOR UPDATE`,
        [context.requestId],
      );
      const current = request.rows[0];
      if (!current) return { kind: "not_found" as const };
      if (!["OPEN", "IN_PROGRESS", "IN_CORRECTION"].includes(current.status)) {
        return { kind: "invalid_state" as const, status: current.status };
      }

      if (current.status === "OPEN") {
        await client.query(
          `UPDATE requests SET status = 'IN_PROGRESS', updated_at = now() WHERE id = $1`,
          [context.requestId],
        );
      }

      const schemaResult = await client.query<{ schema_json: unknown }>(
        `SELECT tv.schema_json
           FROM requests r
           LEFT JOIN template_versions tv ON tv.id = r.template_version_id
          WHERE r.id = $1
          LIMIT 1`,
        [context.requestId],
      );
      const fields = readSchemaFields(schemaResult.rows[0]?.schema_json);
      const existing = await client.query<{ data: Record<string, unknown> }>(
        `SELECT data FROM request_items
          WHERE tenant_id = $1 AND request_id = $2 AND item_key = $3`,
        [context.tenantId, context.requestId, input.itemKey],
      );
      const prepared = prepareItemData({
        existing: existing.rows[0]?.data ?? {},
        incoming: input.data,
        fields,
        viewer: guestFieldViewer,
      });
      if (!prepared.ok) return { kind: "field_locked" as const, fields: prepared.fields };
      const guestCalculatedData = prepared.data;

      const result = await client.query(
        `INSERT INTO request_items
          (tenant_id, request_id, item_key, data, status, last_edited_guest_link_id)
         VALUES ($1, $2, $3, $4::jsonb, 'DRAFT', $5)
         ON CONFLICT (tenant_id, request_id, item_key)
         DO UPDATE SET
           data = EXCLUDED.data,
           last_edited_by = NULL,
           last_edited_guest_link_id = EXCLUDED.last_edited_guest_link_id,
           status = CASE
             WHEN request_items.status = 'RETURNED' THEN 'DRAFT'
             ELSE request_items.status
           END,
           updated_at = now()
         WHERE request_items.status IN ('DRAFT', 'RETURNED')
         RETURNING id, item_key, data, status, updated_at`,
        [
          context.tenantId,
          context.requestId,
          input.itemKey,
          JSON.stringify(guestCalculatedData),
          context.guestLinkId,
        ],
      );

      if (result.rowCount !== 1) return { kind: "item_locked" as const };

      await client.query(
        `INSERT INTO audit_events
          (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, NULL, 'GUEST_REQUEST_ITEM_SAVED', 'request_item', $2, $3::jsonb)`,
        [
          context.tenantId,
          result.rows[0].id,
          JSON.stringify({
            guestLinkId: context.guestLinkId,
            guestEmail: context.email,
            itemKey: input.itemKey,
          }),
        ],
      );

      const saved = result.rows[0] as { data: Record<string, unknown> };
      saved.data = redactData(saved.data, fields, guestFieldViewer);
      return { kind: "saved" as const, item: saved };
    });
  });
}

export async function submitGuestResponse(sessionToken: string) {
  return withGuestSession(sessionToken, async (context) => {
    return withTenantTransaction(context.tenantId, async (client) => {
      const request = await client.query<{ status: string }>(
        `SELECT status FROM requests WHERE id = $1 FOR UPDATE`,
        [context.requestId],
      );
      const current = request.rows[0];
      if (!current) return { kind: "not_found" as const };
      if (!["IN_PROGRESS", "IN_CORRECTION", "OPEN"].includes(current.status)) {
        return { kind: "invalid_state" as const, status: current.status };
      }

      const count = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM request_items
          WHERE request_id = $1
            AND status IN ('DRAFT', 'RETURNED')`,
        [context.requestId],
      );
      if (Number(count.rows[0]?.count ?? 0) === 0) {
        return { kind: "nothing_to_submit" as const };
      }

      await client.query(
        `UPDATE request_items
            SET status = 'SUBMITTED',
                submitted_by = NULL,
                submitted_guest_link_id = $2,
                submitted_at = now(),
                return_comment = NULL,
                correction_due_at = NULL,
                updated_at = now()
          WHERE request_id = $1
            AND status IN ('DRAFT', 'RETURNED')`,
        [context.requestId, context.guestLinkId],
      );

      await client.query(
        `UPDATE requests SET status = 'IN_REVIEW', updated_at = now() WHERE id = $1`,
        [context.requestId],
      );

      await client.query(
        `INSERT INTO audit_events
          (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, NULL, 'GUEST_REQUEST_SUBMITTED', 'request', $2, $3::jsonb)`,
        [
          context.tenantId,
          context.requestId,
          JSON.stringify({
            guestLinkId: context.guestLinkId,
            guestEmail: context.email,
            status: "IN_REVIEW",
          }),
        ],
      );

      return { kind: "submitted" as const };
    });
  });
}
