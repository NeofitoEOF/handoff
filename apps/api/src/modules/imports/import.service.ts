import crypto from "node:crypto";
import ExcelJS from "exceljs";
import { withTenantTransaction } from "../../db.js";
import { putObject } from "../../storage.js";

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

  const sha256 = crypto.createHash("sha256").update(input.buffer).digest("hex");
  const storageKey = `${input.tenantId}/${input.requestId}/imports/${sha256}.xlsx`;

  const context = await withTenantTransaction(input.tenantId, async (client) => {
    const result = await client.query<{
      status: string;
      assigned_to: string | null;
      destination_sector_id: string;
      template_version_id: string | null;
      schema_json: { fields: TemplateField[] } | null;
    }>(
      `SELECT r.status, r.assigned_to, r.destination_sector_id, r.template_version_id,
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

    const membership = await client.query(
      `SELECT 1 FROM memberships
        WHERE sector_id = $1 AND user_id = $2 AND active = true LIMIT 1`,
      [request.destination_sector_id, input.actorUserId],
    );
    if (membership.rowCount !== 1) return { kind: "forbidden" as const };

    return { kind: "ok" as const, schema: request.schema_json };
  });

  if (context.kind !== "ok") return context;

  await putObject({ key: storageKey, body: input.buffer, contentType: input.mimeType });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input.buffer);
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

    if (rowValid) accepted.push({ itemKey: `xlsx-row-${rowNumber}`, data });
  }

  return withTenantTransaction(input.tenantId, async (client) => {
    const importResult = await client.query<{ id: string }>(
      `INSERT INTO imports
        (tenant_id, request_id, uploaded_by, filename, storage_key, sha256, status,
         total_rows, accepted_rows, rejected_rows, errors, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'COMPLETED', $7, $8, $9, $10::jsonb, now())
       RETURNING id`,
      [
        input.tenantId, input.requestId, input.actorUserId, input.filename,
        storageKey, sha256, Math.max(worksheet.rowCount - 1, 0),
        accepted.length, new Set(errors.map((x) => x.row)).size, JSON.stringify(errors),
      ],
    );

    for (const item of accepted) {
      await client.query(
        `INSERT INTO request_items
          (tenant_id, request_id, item_key, data, status, last_edited_by)
         VALUES ($1, $2, $3, $4::jsonb, 'DRAFT', $5)
         ON CONFLICT (tenant_id, request_id, item_key)
         DO UPDATE SET data = EXCLUDED.data, last_edited_by = EXCLUDED.last_edited_by,
                       updated_at = now()
         WHERE request_items.status IN ('DRAFT', 'RETURNED')`,
        [input.tenantId, input.requestId, item.itemKey, JSON.stringify(item.data), input.actorUserId],
      );
    }

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'XLSX_IMPORTED', 'import', $3, $4::jsonb)`,
      [
        input.tenantId, input.actorUserId, importResult.rows[0]!.id,
        JSON.stringify({ sha256, acceptedRows: accepted.length, errorCount: errors.length }),
      ],
    );

    return {
      kind: "completed" as const,
      importId: importResult.rows[0]!.id,
      sha256,
      acceptedRows: accepted.length,
      rejectedRows: new Set(errors.map((x) => x.row)).size,
      errors,
    };
  });
}
