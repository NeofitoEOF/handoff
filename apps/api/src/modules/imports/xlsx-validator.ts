import ExcelJS from "exceljs";

export type XlsxTemplateField = {
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

function validateValue(field: XlsxTemplateField, value: unknown): string | null {
  const empty = value === null || value === undefined || value === "";
  if (field.required && empty) return "Campo obrigatório.";
  if (empty) return null;

  if (field.type === "NUMBER" || field.type === "MONEY") {
    const number = typeof value === "number" ? value : Number(String(value).replace(",", "."));
    if (!Number.isFinite(number)) return "Valor numérico inválido.";
    if (field.min !== undefined && number < field.min) return `Valor menor que ${field.min}.`;
    if (field.max !== undefined && number > field.max) return `Valor maior que ${field.max}.`;
  }

  const text = String(value).trim();
  if (field.regex && !new RegExp(field.regex).test(text)) return "Formato inválido.";
  if (field.type === "SELECT" && field.options && !field.options.includes(text)) {
    return "Valor fora da lista permitida.";
  }
  return null;
}

export async function validateXlsxBuffer(
  buffer: Buffer,
  schema: { fields: XlsxTemplateField[] },
) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return { kind: "empty_workbook" as const };
  if (worksheet.rowCount > 10001) return { kind: "too_many_rows" as const };
  if (worksheet.columnCount > 200) return { kind: "too_many_columns" as const };

  const headers = new Map<string, number>();
  worksheet.getRow(1).eachCell((cell, column) => {
    headers.set(String(normalizeCell(cell.value) ?? "").trim(), column);
  });

  const errors: Array<{ row: number; field: string; message: string }> = [];
  const accepted: Array<{ itemKey: string; data: Record<string, unknown> }> = [];

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const data: Record<string, unknown> = {};
    let valid = true;

    for (const field of schema.fields) {
      const column = headers.get(field.key) ?? headers.get(field.label);
      const value = column ? normalizeCell(row.getCell(column).value) : null;
      const error = validateValue(field, value);
      if (error) {
        errors.push({ row: rowNumber, field: field.key, message: error });
        valid = false;
      }
      data[field.key] = value;
    }

    if (valid) accepted.push({ itemKey: `xlsx-row-${rowNumber}`, data });
  }

  return {
    kind: "validated" as const,
    totalRows: Math.max(worksheet.rowCount - 1, 0),
    accepted,
    rejectedRows: new Set(errors.map((error) => error.row)).size,
    errors,
  };
}
