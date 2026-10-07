import crypto from "node:crypto";
import { scanBuffer } from "../../antivirus.js";
import { withTenantTransaction } from "../../db.js";
import { putObject } from "../../storage.js";
import { validateXlsxBuffer, type XlsxTemplateField } from "../imports/xlsx-validator.js";
import { withGuestSession } from "./guest.service.js";

export async function guestValidateXlsx(input: {
  sessionToken: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}) {
  if (input.buffer.byteLength > 20 * 1024 * 1024) {
    return { kind: "file_too_large" as const };
  }

  const antivirus = await scanBuffer(input.buffer);
  if (antivirus.status === "INFECTED") {
    return { kind: "malware_detected" as const, signature: antivirus.signature };
  }
  if (antivirus.status === "UNAVAILABLE") {
    return { kind: "antivirus_unavailable" as const };
  }

  return withGuestSession(input.sessionToken, async (context) => {
    const request = await withTenantTransaction(context.tenantId, async (client) => {
      const result = await client.query<{
        status: string;
        schema_json: { fields: XlsxTemplateField[] } | null;
      }>(
        `SELECT r.status, tv.schema_json
           FROM requests r
           LEFT JOIN template_versions tv ON tv.id = r.template_version_id
          WHERE r.id = $1`,
        [context.requestId],
      );
      return result.rows[0] ?? null;
    });

    if (!request) return { kind: "not_found" as const };
    if (!["OPEN", "IN_PROGRESS", "IN_CORRECTION"].includes(request.status)) {
      return { kind: "invalid_state" as const, status: request.status };
    }
    if (!request.schema_json) return { kind: "missing_template" as const };

    const validation = await validateXlsxBuffer(input.buffer, request.schema_json);
    if (validation.kind !== "validated") return validation;

    const sha256 = crypto.createHash("sha256").update(input.buffer).digest("hex");
    const storageKey = `${context.tenantId}/${context.requestId}/guest-imports/${sha256}.xlsx`;
    await putObject({ key: storageKey, body: input.buffer, contentType: input.mimeType });

    return withTenantTransaction(context.tenantId, async (client) => {
      const created = await client.query<{ id: string }>(
        `INSERT INTO imports
          (tenant_id, request_id, uploaded_by, uploaded_guest_link_id, filename, storage_key,
           sha256, status, total_rows, accepted_rows, rejected_rows, errors, staged_items, completed_at)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, 'VALIDATED', $7, $8, $9, $10::jsonb, $11::jsonb, now())
         RETURNING id`,
        [
          context.tenantId,
          context.requestId,
          context.guestLinkId,
          input.filename,
          storageKey,
          sha256,
          validation.totalRows,
          validation.accepted.length,
          validation.rejectedRows,
          JSON.stringify(validation.errors),
          JSON.stringify(validation.accepted),
        ],
      );

      return {
        kind: "validated" as const,
        importId: created.rows[0]!.id,
        acceptedRows: validation.accepted.length,
        rejectedRows: validation.rejectedRows,
        errors: validation.errors,
      };
    });
  });
}

export async function guestConfirmXlsx(input: {
  sessionToken: string;
  importId: string;
}) {
  return withGuestSession(input.sessionToken, async (context) => {
    return withTenantTransaction(context.tenantId, async (client) => {
      const result = await client.query<{
        status: string;
        uploaded_guest_link_id: string | null;
        staged_items: Array<{ itemKey: string; data: Record<string, unknown> }>;
      }>(
        `SELECT status, uploaded_guest_link_id, staged_items
           FROM imports
          WHERE id = $1 AND request_id = $2
          FOR UPDATE`,
        [input.importId, context.requestId],
      );
      const current = result.rows[0];
      if (!current) return { kind: "not_found" as const };
      if (current.uploaded_guest_link_id !== context.guestLinkId) return { kind: "forbidden" as const };
      if (current.status === "CONFIRMED") return { kind: "already_confirmed" as const };
      if (current.status !== "VALIDATED") return { kind: "invalid_state" as const, status: current.status };

      for (const item of current.staged_items) {
        await client.query(
          `INSERT INTO request_items
            (tenant_id, request_id, item_key, data, status, last_edited_by, last_edited_guest_link_id)
           VALUES ($1, $2, $3, $4::jsonb, 'DRAFT', NULL, $5)
           ON CONFLICT (tenant_id, request_id, item_key)
           DO UPDATE SET
             data = EXCLUDED.data,
             last_edited_by = NULL,
             last_edited_guest_link_id = EXCLUDED.last_edited_guest_link_id,
             status = CASE WHEN request_items.status = 'RETURNED' THEN 'DRAFT' ELSE request_items.status END,
             updated_at = now()
           WHERE request_items.status IN ('DRAFT', 'RETURNED')`,
          [
            context.tenantId,
            context.requestId,
            item.itemKey,
            JSON.stringify(item.data),
            context.guestLinkId,
          ],
        );
      }

      await client.query(
        `UPDATE imports SET status = 'CONFIRMED', staged_items = '[]'::jsonb WHERE id = $1`,
        [input.importId],
      );

      await client.query(
        `UPDATE requests
            SET status = CASE WHEN status = 'OPEN' THEN 'IN_PROGRESS' ELSE status END,
                updated_at = now()
          WHERE id = $1`,
        [context.requestId],
      );

      if (input.itemId && ["IN_REVIEW", "APPROVED"].includes(request.status)) {
        await client.query(
          `UPDATE request_items
              SET status = 'DRAFT',
                  reviewed_by = NULL,
                  reviewed_at = NULL,
                  updated_at = now()
            WHERE id = $1
              AND status IN ('SUBMITTED', 'APPROVED')`,
          [input.itemId],
        );
        await client.query(
          `UPDATE requests
              SET status = 'IN_CORRECTION', updated_at = now()
            WHERE id = $1
              AND status IN ('IN_REVIEW', 'APPROVED')`,
          [context.requestId],
        );
      }

      await client.query(
        `INSERT INTO audit_events
          (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, NULL, 'GUEST_XLSX_IMPORT_CONFIRMED', 'import', $2, $3::jsonb)`,
        [
          context.tenantId,
          input.importId,
          JSON.stringify({ guestLinkId: context.guestLinkId, importedRows: current.staged_items.length }),
        ],
      );

      return { kind: "confirmed" as const, importedRows: current.staged_items.length };
    });
  });
}

export async function guestUploadEvidence(input: {
  sessionToken: string;
  itemId?: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}) {
  if (input.buffer.byteLength > 20 * 1024 * 1024) return { kind: "file_too_large" as const };

  const antivirus = await scanBuffer(input.buffer);
  if (antivirus.status === "INFECTED") {
    return { kind: "malware_detected" as const, signature: antivirus.signature };
  }
  if (antivirus.status === "UNAVAILABLE") return { kind: "antivirus_unavailable" as const };

  return withGuestSession(input.sessionToken, async (context) => {
    return withTenantTransaction(context.tenantId, async (client) => {
      const requestResult = await client.query<{ status: string }>(
        `SELECT status FROM requests WHERE id = $1 FOR UPDATE`,
        [context.requestId],
      );
      const request = requestResult.rows[0];
      if (!request) return { kind: "not_found" as const };
      if (["CLOSED", "CANCELLED"].includes(request.status)) {
        return { kind: "invalid_state" as const, status: request.status };
      }

      if (input.itemId) {
        const item = await client.query(
          `SELECT 1 FROM request_items WHERE id = $1 AND request_id = $2 LIMIT 1`,
          [input.itemId, context.requestId],
        );
        if (item.rowCount !== 1) return { kind: "item_not_found" as const };
      }

      const sha256 = crypto.createHash("sha256").update(input.buffer).digest("hex");
      const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storageKey = `${context.tenantId}/${context.requestId}/guest-evidence/${sha256}-${safeName}`;
      await putObject({ key: storageKey, body: input.buffer, contentType: input.mimeType });

      const attachment = await client.query(
        `INSERT INTO attachments
          (tenant_id, request_id, item_id, uploaded_by, uploaded_guest_link_id, filename,
           mime_type, size_bytes, sha256, storage_key, status)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, 'AVAILABLE')
         RETURNING id, filename, mime_type, size_bytes, sha256, status, created_at`,
        [
          context.tenantId,
          context.requestId,
          input.itemId ?? null,
          context.guestLinkId,
          input.filename,
          input.mimeType,
          input.buffer.byteLength,
          sha256,
          storageKey,
        ],
      );

      await client.query(
        `INSERT INTO audit_events
          (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, NULL, 'GUEST_EVIDENCE_UPLOADED', 'attachment', $2, $3::jsonb)`,
        [
          context.tenantId,
          attachment.rows[0].id,
          JSON.stringify({ guestLinkId: context.guestLinkId, itemId: input.itemId ?? null, sha256 }),
        ],
      );

      return { kind: "uploaded" as const, attachment: attachment.rows[0] };
    });
  });
}
