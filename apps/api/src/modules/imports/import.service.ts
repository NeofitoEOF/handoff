import crypto from "node:crypto";
import ExcelJS from "exceljs";
import { withTenantTransaction } from "../../db.js";
import { putObject } from "../../storage.js";
import { scanBuffer } from "../../antivirus.js";
import { loadDefaultImportMapping } from "./import-mapping.service.js";
import { checkTenantStorageCapacity } from "../billing/billing.service.js";
import { applyItemCalculations } from "../templates/calculations.js";
import { fieldsForEntry, readSchemaFields } from "../templates/field-access.js";
import { loadFieldViewer } from "../templates/field-viewer.js";

type TemplateField = {
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "MONEY" | "DATE" | "CPF" | "CNPJ" | "SELECT" | "BOOLEAN" | "ATTACHMENT";
  required?: boolean;
  min?: number;
  max?: number;
  regex?: string;
  options?: string[];
};

function normalizeCell(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value) return value.result ?? null;
    if ("text" in value) return value.text;
    if ("richText" in value) return value.richText.map((x) => x.text).join("");
  }
  return value;
}

function validateValue(field: TemplateField, value: unknown): string | null {
  const empty = value === null || value === undefined || value === "";
  if (field.required && empty) return "Campo obrigatório.";
  if (empty) return null;

  if (field.type === "NUMBER" || field.type === "MONEY") {
    const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
    if (!Number.isFinite(n)) return "Valor numérico inválido.";
    if (field.min !== undefined && n < field.min) return `Valor menor que ${field.min}.`;
    if (field.max !== undefined && n > field.max) return `Valor maior que ${field.max}.`;
  }

  const text = String(value).trim();
  if (field.regex && !(new RegExp(field.regex).test(text))) return "Formato inválido.";
  if (field.type === "SELECT" && field.options && !field.options.includes(text)) {
    return "Valor fora da lista permitida.";
  }
  return null;
}

export async function importXlsx(input: {
  tenantId: string;
  requestId: string;
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

  const sha256 = crypto.createHash("sha256").update(input.buffer).digest("hex");
  const storageKey = `${input.tenantId}/${input.requestId}/imports/${sha256}.xlsx`;

  const context = await withTenantTransaction(input.tenantId, async (client) => {
    const result = await client.query<{
      status: string;
      assigned_to: string | null;
      origin_sector_id: string;
      destination_sector_id: string;
      template_version_id: string | null;
      schema_json: { fields: TemplateField[] } | null;
    }>(
      `SELECT r.status, r.assigned_to, r.origin_sector_id, r.destination_sector_id, r.template_version_id,
              tv.schema_json
         FROM requests r
         LEFT JOIN template_versions tv ON tv.id = r.template_version_id
        WHERE r.id = $1`,
      [input.requestId],
    );
    const request = result.rows[0];
    if (!request) return { kind: "not_found" as const };
    if (!["IN_PROGRESS", "IN_CORRECTION"].includes(request.status)) {
      return { kind: "invalid_state" as const, status: request.status };
    }
    if (request.assigned_to && request.assigned_to !== input.actorUserId) {
      return { kind: "forbidden" as const };
    }
    if (!request.schema_json) return { kind: "missing_template" as const };

    const viewer = await loadFieldViewer(client, input.actorUserId, [
      request.origin_sector_id,
      request.destination_sector_id,
    ]);
    const editableFields = fieldsForEntry(readSchemaFields(request.schema_json), viewer) as TemplateField[];

    const membership = await client.query(
      `SELECT 1 FROM memberships
        WHERE sector_id = $1 AND user_id = $2 AND active = true LIMIT 1`,
      [request.destination_sector_id, input.actorUserId],
    );
    if (membership.rowCount !== 1) return { kind: "forbidden" as const };

    return {
      kind: "ok" as const,
      schema: { fields: editableFields },
      allFields: readSchemaFields(request.schema_json),
    };
  });

  if (context.kind !== "ok") return context;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input.buffer as any);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return { kind: "empty_workbook" as const };
  if (worksheet.rowCount > 10001) return { kind: "too_many_rows" as const };
  if (worksheet.columnCount > 200) return { kind: "too_many_columns" as const };

  const headerRow = worksheet.getRow(1);
  const headers = new Map<string, number>();
  headerRow.eachCell((cell, col) => {
    headers.set(String(normalizeCell(cell.value) ?? "").trim(), col);
  });

  const errors: Array<{ row: number; field: string; message: string }> = [];
  const accepted: Array<{ itemKey: string; data: Record<string, unknown> }> = [];

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const data: Record<string, unknown> = {};
    let rowValid = true;

    for (const field of context.schema.fields) {
      const col = headers.get(field.key) ?? headers.get(field.label);
      const value = col ? normalizeCell(row.getCell(col).value) : null;
      const error = validateValue(field, value);
      if (error) {
        errors.push({ row: rowNumber, field: field.key, message: error });
        rowValid = false;
      }
      data[field.key] = value;
    }

    if (rowValid) {
      accepted.push({
        itemKey: `xlsx-row-${rowNumber}`,
        data: applyItemCalculations(data, context.allFields),
      });
    }
  }

  return withTenantTransaction(input.tenantId, async (client) => {
    const capacity = await checkTenantStorageCapacity(
      client,
      input.tenantId,
      input.buffer.byteLength,
    );
    if (!capacity.allowed) {
      return {
        kind: "storage_limit" as const,
        reason: capacity.reason,
        ...("usedBytes" in capacity ? { usedBytes: capacity.usedBytes } : {}),
        ...("limitBytes" in capacity ? { limitBytes: capacity.limitBytes } : {}),
      };
    }

    await putObject({ key: storageKey, body: input.buffer, contentType: input.mimeType });

    const importResult = await client.query<{ id: string }>(
      `INSERT INTO imports
        (tenant_id, request_id, uploaded_by, filename, size_bytes, storage_key, sha256, status,
         total_rows, accepted_rows, rejected_rows, errors, staged_items, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'VALIDATED', $8, $9, $10, $11::jsonb, $12::jsonb, now())
       RETURNING id`,
      [
        input.tenantId, input.requestId, input.actorUserId, input.filename,
        input.buffer.byteLength, storageKey, sha256, Math.max(worksheet.rowCount - 1, 0),
        accepted.length, new Set(errors.map((x) => x.row)).size,
        JSON.stringify(errors), JSON.stringify(accepted),
      ],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'XLSX_VALIDATED', 'import', $3, $4::jsonb)`,
      [
        input.tenantId, input.actorUserId, importResult.rows[0]!.id,
        JSON.stringify({ sha256, acceptedRows: accepted.length, errorCount: errors.length }),
      ],
    );

    return {
      kind: "validated" as const,
      importId: importResult.rows[0]!.id,
      sha256,
      acceptedRows: accepted.length,
      rejectedRows: new Set(errors.map((x) => x.row)).size,
      errors,
    };
  });
}

export async function confirmXlsxImport(input: {
  tenantId: string;
  requestId: string;
  importId: string;
  actorUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const importResult = await client.query<{
      id: string;
      status: string;
      uploaded_by: string;
      staged_items: Array<{ itemKey: string; data: Record<string, unknown> }>;
    }>(
      `SELECT id, status, uploaded_by, staged_items
         FROM imports
        WHERE id = $1 AND request_id = $2
        FOR UPDATE`,
      [input.importId, input.requestId],
    );

    const current = importResult.rows[0];
    if (!current) return { kind: "not_found" as const };
    if (current.status === "CONFIRMED") return { kind: "already_confirmed" as const };
    if (current.status !== "VALIDATED") return { kind: "invalid_state" as const, status: current.status };
    if (current.uploaded_by !== input.actorUserId) return { kind: "forbidden" as const };

    const schemaRow = await client.query<{ schema_json: unknown }>(
      `SELECT tv.schema_json
         FROM requests r
         LEFT JOIN template_versions tv ON tv.id = r.template_version_id
        WHERE r.id = $1`,
      [input.requestId],
    );
    const fields = readSchemaFields(schemaRow.rows[0]?.schema_json);

    for (const item of current.staged_items) {
      const existing = await client.query<{ data: Record<string, unknown> }>(
        `SELECT data FROM request_items
          WHERE tenant_id = $1 AND request_id = $2 AND item_key = $3`,
        [input.tenantId, input.requestId, item.itemKey],
      );
      const merged = applyItemCalculations(
        { ...(existing.rows[0]?.data ?? {}), ...item.data },
        fields,
      );
      await client.query(
        `INSERT INTO request_items
          (tenant_id, request_id, item_key, data, status, last_edited_by)
         VALUES ($1, $2, $3, $4::jsonb, 'DRAFT', $5)
         ON CONFLICT (tenant_id, request_id, item_key)
         DO UPDATE SET data = EXCLUDED.data, last_edited_by = EXCLUDED.last_edited_by,
                       status = CASE WHEN request_items.status = 'RETURNED' THEN 'DRAFT' ELSE request_items.status END,
                       updated_at = now()
         WHERE request_items.status IN ('DRAFT', 'RETURNED')`,
        [input.tenantId, input.requestId, item.itemKey, JSON.stringify(merged), input.actorUserId],
      );
    }

    await client.query(
      `UPDATE imports
          SET status = 'CONFIRMED', staged_items = '[]'::jsonb, completed_at = now()
        WHERE id = $1`,
      [input.importId],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'XLSX_IMPORT_CONFIRMED', 'import', $3, $4::jsonb)`,
      [input.tenantId, input.actorUserId, input.importId, JSON.stringify({ requestId: input.requestId })],
    );

    return { kind: "confirmed" as const, importedRows: current.staged_items.length };
  });
}
