import ExcelJS from "exceljs";

type FieldType = "TEXT" | "NUMBER" | "MONEY" | "DATE" | "CPF" | "CNPJ" | "SELECT" | "BOOLEAN" | "ATTACHMENT";

function keyFromHeader(header: string, index: number): string {
  const normalized = header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || `campo_${index}`;
}

function scalar(value: ExcelJS.CellValue): unknown {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if ("result" in value) return value.result ?? null;
    if ("text" in value) return value.text;
    if ("richText" in value) return value.richText.map((x) => x.text).join("");
  }
  return value;
}

function inferType(values: unknown[], header: string): FieldType {
  const nonEmpty = values.filter((x) => x !== null && x !== undefined && x !== "");
  if (nonEmpty.length === 0) return "TEXT";
  if (nonEmpty.every((x) => x instanceof Date)) return "DATE";
  if (nonEmpty.every((x) => typeof x === "boolean")) return "BOOLEAN";
  if (nonEmpty.every((x) => typeof x === "number")) {
    return /valor|preco|preço|total|saldo/i.test(header) ? "MONEY" : "NUMBER";
  }

  const texts = nonEmpty.map(String).map((x) => x.replace(/\D/g, ""));
  if (/cpf/i.test(header) && texts.every((x) => x.length === 11)) return "CPF";
  if (/cnpj/i.test(header) && texts.every((x) => x.length === 14)) return "CNPJ";
  return "TEXT";
}

export async function inferTemplateFromXlsx(buffer: Buffer) {
  if (buffer.byteLength > 20 * 1024 * 1024) {
    return { kind: "file_too_large" as const };
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { kind: "empty_workbook" as const };
  if (sheet.columnCount > 200) return { kind: "too_many_columns" as const };

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    headers[col - 1] = String(scalar(cell.value) ?? "").trim();
  });

  const usedKeys = new Set<string>();
  const fields = headers
    .map((header, index) => {
      if (!header) return null;

      let key = keyFromHeader(header, index + 1);
      let suffix = 2;
      while (usedKeys.has(key)) {
        key = `${keyFromHeader(header, index + 1)}_${suffix++}`;
      }
      usedKeys.add(key);

      const values: unknown[] = [];
      const maxRow = Math.min(sheet.rowCount, 101);
      for (let row = 2; row <= maxRow; row++) {
        values.push(scalar(sheet.getRow(row).getCell(index + 1).value));
      }

      const nonEmptyCount = values.filter((x) => x !== null && x !== undefined && x !== "").length;
      return {
        key,
        label: header,
        type: inferType(values, header),
        required: values.length > 0 && nonEmptyCount === values.length,
      };
    })
    .filter((field): field is NonNullable<typeof field> => field !== null);

  if (fields.length === 0) return { kind: "no_headers" as const };

  return {
    kind: "inferred" as const,
    schema: { fields },
    sampleRows: Math.min(Math.max(sheet.rowCount - 1, 0), 100),
  };
}
