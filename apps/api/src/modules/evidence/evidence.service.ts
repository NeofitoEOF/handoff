import crypto from "node:crypto";
import { withTenantTransaction } from "../../db.js";
import { putObject } from "../../storage.js";

export async function uploadEvidence(input: {
  tenantId: string;
  requestId: string;
  itemId?: string;
  actorUserId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}) {
  if (input.buffer.byteLength > 20 * 1024 * 1024) {
    return { kind: "file_too_large" as const };
  }

  return withTenantTransaction(input.tenantId, async (client) => {
    const request = await client.query<{
      status: string;
      origin_sector_id: string;
      destination_sector_id: string;
    }>(
      `SELECT status, origin_sector_id, destination_sector_id
         FROM requests
        WHERE id = $1`,
      [input.requestId],
    );

    const current = request.rows[0];
    if (!current) return { kind: "not_found" as const };
    if (["CLOSED", "CANCELLED"].includes(current.status)) {
      return { kind: "invalid_state" as const, status: current.status };
    }

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

    if (input.itemId) {
      const item = await client.query(
        `SELECT 1 FROM request_items WHERE id = $1 AND request_id = $2 LIMIT 1`,
        [input.itemId, input.requestId],
      );
      if (item.rowCount !== 1) return { kind: "item_not_found" as const };
    }

    const sha256 = crypto.createHash("sha256").update(input.buffer).digest("hex");
    const safeFilename = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storageKey = `${input.tenantId}/${input.requestId}/evidence/${sha256}-${safeFilename}`;

    await putObject({
      key: storageKey,
      body: input.buffer,
      contentType: input.mimeType,
    });

    const attachment = await client.query(
      `INSERT INTO attachments
        (tenant_id, request_id, item_id, uploaded_by, filename, mime_type,
         size_bytes, sha256, storage_key, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'AVAILABLE')
       RETURNING id, request_id, item_id, filename, mime_type, size_bytes, sha256, status, created_at`,
      [
        input.tenantId,
        input.requestId,
        input.itemId ?? null,
        input.actorUserId,
        input.filename,
        input.mimeType,
        input.buffer.byteLength,
        sha256,
        storageKey,
      ],
    );

    if (input.itemId && ["IN_REVIEW", "APPROVED"].includes(current.status)) {
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
        [input.requestId],
      );
    }

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'EVIDENCE_UPLOADED', 'attachment', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        attachment.rows[0].id,
        JSON.stringify({
          requestId: input.requestId,
          itemId: input.itemId ?? null,
          sha256,
          filename: input.filename,
        }),
      ],
    );

    return { kind: "uploaded" as const, attachment: attachment.rows[0] };
  });
}
