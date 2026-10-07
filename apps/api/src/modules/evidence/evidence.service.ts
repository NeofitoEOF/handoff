import crypto from "node:crypto";
import { withTenantTransaction } from "../../db.js";
import { getPresignedDownloadUrl, putObject } from "../../storage.js";
import { scanBuffer } from "../../antivirus.js";

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

  const antivirus = await scanBuffer(input.buffer);
  if (antivirus.status === "INFECTED") {
    return { kind: "malware_detected" as const, signature: antivirus.signature };
  }
  if (antivirus.status === "UNAVAILABLE") {
    return { kind: "antivirus_unavailable" as const, error: antivirus.error };
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


export async function listEvidence(input: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
}) {
  const rows = await withTenantTransaction(input.tenantId, async (client) => {
    const access = await client.query(
      `SELECT 1
         FROM requests r
         LEFT JOIN memberships mo
           ON mo.sector_id = r.origin_sector_id AND mo.user_id = $2 AND mo.active = true
         LEFT JOIN memberships md
           ON md.sector_id = r.destination_sector_id AND md.user_id = $2 AND md.active = true
         LEFT JOIN tenant_users tu
           ON tu.tenant_id = r.tenant_id AND tu.user_id = $2
          AND tu.active = true AND tu.role IN ('ADMIN', 'AUDITOR')
        WHERE r.id = $1
          AND (mo.id IS NOT NULL OR md.id IS NOT NULL OR tu.id IS NOT NULL)
        LIMIT 1`,
      [input.requestId, input.actorUserId],
    );
    if (access.rowCount !== 1) return null;

    const result = await client.query<{
      id: string;
      item_id: string | null;
      filename: string;
      mime_type: string;
      size_bytes: number;
      sha256: string;
      storage_key: string;
      created_at: Date;
      uploaded_by: string | null;
      uploaded_guest_link_id: string | null;
      uploader_name: string | null;
      guest_email: string | null;
    }>(
      `SELECT a.id, a.item_id, a.filename, a.mime_type, a.size_bytes, a.sha256,
              a.storage_key, a.created_at, a.uploaded_by, a.uploaded_guest_link_id,
              u.name AS uploader_name, gl.email AS guest_email
         FROM attachments a
         LEFT JOIN users u ON u.id = a.uploaded_by
         LEFT JOIN guest_links gl ON gl.id = a.uploaded_guest_link_id
        WHERE a.request_id = $1
          AND a.status = 'AVAILABLE'
        ORDER BY a.created_at DESC`,
      [input.requestId],
    );
    return result.rows;
  });

  if (!rows) return { kind: "not_found" as const };

  const data = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      itemId: row.item_id,
      filename: row.filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      createdAt: row.created_at,
      uploadedBy: row.guest_email ?? row.uploader_name ?? "Sistema",
      downloadUrl: await getPresignedDownloadUrl(row.storage_key, 300),
    })),
  );

  return { kind: "ok" as const, data };
}
