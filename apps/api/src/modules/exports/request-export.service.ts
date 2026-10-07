import ExcelJS from "exceljs";
import { withTenantTransaction } from "../../db.js";

async function loadExportData(input: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const access = await client.query<{
      title: string;
      competence: string | null;
      origin_sector_id: string;
      destination_sector_id: string;
    }>(
      `SELECT r.title, r.competence, r.origin_sector_id, r.destination_sector_id
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
    const request = access.rows[0];
    if (!request) return { kind: "not_found" as const };

    const items = await client.query<{
      item_key: string;
      data: Record<string, unknown>;
      status: string;
      updated_at: Date;
    }>(
      `SELECT item_key, data, status, updated_at
         FROM request_items
        WHERE request_id = $1
        ORDER BY created_at, item_key`,
      [input.requestId],
    );

    const fields = new Set<string>();
    for (const item of items.rows) {
      for (const key of Object.keys(item.data ?? {})) fields.add(key);
    }

    return {
      kind: "ok" as const,
      request,
      items: items.rows,
      fields: [...fields],
    };
  });
}

function safeSpreadsheetText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value: unknown): string {
  const text = safeSpreadsheetText(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function exportRequestXlsx(input: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
}) {
  const data = await loadExportData(input);
  if (data.kind !== "ok") return data;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Dados aprovados");
  const headers = ["item_key", ...data.fields, "status", "updated_at"];
  sheet.addRow(headers);

  for (const item of data.items) {
    sheet.addRow([
      safeSpreadsheetText(item.item_key),
      ...data.fields.map((key) => safeSpreadsheetText(item.data?.[key])),
      safeSpreadsheetText(item.status),
      item.updated_at.toISOString(),
    ]);
  }

  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  for (const column of sheet.columns) {
    const values = column.values ?? [];
    column.width = Math.min(
      50,
      Math.max(12, ...values.slice(1).map((value) => String(value ?? "").length + 2)),
    );
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    kind: "ok" as const,
    filename: `${data.request.title.replace(/[^a-zA-Z0-9._-]/g, "_")}.xlsx`,
    buffer: Buffer.from(buffer),
  };
}

export async function exportRequestCsv(input: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
}) {
  const data = await loadExportData(input);
  if (data.kind !== "ok") return data;

  const headers = ["item_key", ...data.fields, "status", "updated_at"];
  const rows = [headers.map(csvCell).join(",")];

  for (const item of data.items) {
    rows.push(
      [
        item.item_key,
        ...data.fields.map((key) => item.data?.[key]),
        item.status,
        item.updated_at.toISOString(),
      ].map(csvCell).join(","),
    );
  }

  return {
    kind: "ok" as const,
    filename: `${data.request.title.replace(/[^a-zA-Z0-9._-]/g, "_")}.csv`,
    content: "\uFEFF" + rows.join("\r\n"),
  };
}
