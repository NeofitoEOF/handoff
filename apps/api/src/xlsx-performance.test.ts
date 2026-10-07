import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { validateXlsxBuffer } from "./modules/imports/xlsx-validator.js";

describe("XLSX performance target", () => {
  it("validates 10,000 data rows in under 60 seconds", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Dados");

    sheet.addRow(["documento", "valor", "centro_custo", "competencia", "observacao"]);

    for (let index = 1; index <= 10_000; index += 1) {
      sheet.addRow([
        `DOC-${index}`,
        index * 1.25,
        `CC-${index % 50}`,
        "2026-10",
        `Linha de teste ${index}`,
      ]);
    }

    const generated = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(generated);

    const startedAt = performance.now();
    const result = await validateXlsxBuffer(buffer, {
      fields: [
        { key: "documento", label: "documento", type: "TEXT", required: true },
        { key: "valor", label: "valor", type: "MONEY", required: true, min: 0 },
        { key: "centro_custo", label: "centro_custo", type: "TEXT", required: true },
        { key: "competencia", label: "competencia", type: "TEXT", required: true },
        { key: "observacao", label: "observacao", type: "TEXT" },
      ],
    });
    const elapsedMs = performance.now() - startedAt;

    expect(result.kind).toBe("validated");
    if (result.kind !== "validated") return;

    expect(result.totalRows).toBe(10_000);
    expect(result.accepted).toHaveLength(10_000);
    expect(result.rejectedRows).toBe(0);
    expect(elapsedMs).toBeLessThan(60_000);
  }, 70_000);
});
