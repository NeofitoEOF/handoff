import ExcelJS from "exceljs";
import { scanBuffer } from "../../antivirus.js";
import { withTenantTransaction } from "../../db.js";
import { isSectorManager } from "../../authorization.js";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const synonyms: Record<string, string[]> = {
  cpf: ["documento cpf", "nr cpf", "numero cpf"],
  cnpj: ["documento cnpj", "nr cnpj", "numero cnpj"],
  valor: ["vlr", "valor total", "total", "amount"],
  descricao: ["desc", "descricao item", "historico"],
  competencia: ["periodo", "mes", "referencia"],
  cfop: ["cod cfop", "codigo cfop"],
  ncm: ["cod ncm", "codigo ncm"],
};

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter(Boolean));
}

function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.88;

  const ta = tokens(na);
  const tb = tokens(nb);
  const intersection = [...ta].filter((token) => tb.has(token)).length;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = union ? intersection / union : 0;

  return jaccard;
}

function candidateNames(field: { key: string; label: string }): string[] {
  const base = [field.key, field.label];
  const normalizedKey = normalize(field.key).replaceAll(" ", "_");
  for (const [key, values] of Object.entries(synonyms)) {
    if (normalizedKey.includes(key) || normalize(field.label).includes(key)) {
      base.push(...values);
    }
  }
  return base;
}

export async function extractXlsxHeaders(buffer: Buffer) {
  if (buffer.byteLength > 20 * 1024 * 1024) {
    return { kind: "file_too_large" as const };
  }

  const antivirus = await scanBuffer(buffer);
  if (antivirus.status === "INFECTED") {
    return { kind: "malware_detected" as const, signature: antivirus.signature };
  }
  if (antivirus.status === "UNAVAILABLE") {
    return { kind: "antivirus_unavailable" as const };
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { kind: "empty_workbook" as const };
  if (sheet.columnCount > 200) return { kind: "too_many_columns" as const };

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
    const value =
      typeof cell.value === "object" && cell.value && "text" in cell.value
        ? cell.value.text
        : cell.value;
    const header = String(value ?? "").trim();
    if (header) headers.push(header);
  });

  return { kind: "ok" as const, headers };
}

export async function suggestImportMapping(input: {
  tenantId: string;
  actorUserId: string;
  templateId: string;
  headers: string[];
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const template = await client.query<{
      sector_id: string;
      schema_json: { fields?: Array<{ key: string; label: string; calculation?: unknown }> } | null;
    }>(
      `SELECT t.sector_id, tv.schema_json
         FROM templates t
         LEFT JOIN template_versions tv ON tv.id = t.published_version_id
        WHERE t.id = $1 AND t.active = true
        LIMIT 1`,
      [input.templateId],
    );

    const current = template.rows[0];
    if (!current) return { kind: "not_found" as const };
    if (!(await isSectorManager(client, current.sector_id, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const fields = current.schema_json?.fields ?? [];
    const mapping: Record<string, string> = {};
    const confidence: Record<string, number> = {};

    for (const field of fields) {
      if (field.calculation) continue;

      let bestHeader = "";
      let bestScore = 0;

      for (const header of input.headers) {
        const score = Math.max(
          ...candidateNames(field).map((candidate) => similarity(candidate, header)),
        );
        if (score > bestScore) {
          bestHeader = header;
          bestScore = score;
        }
      }

      if (bestHeader && bestScore >= 0.45) {
        mapping[field.key] = bestHeader;
        confidence[field.key] = Number(bestScore.toFixed(2));
      }
    }

    return {
      kind: "suggested" as const,
      mapping,
      confidence,
      fields: fields
        .filter((field) => !field.calculation)
        .map((field) => ({ key: field.key, label: field.label })),
    };
  });
}

export async function saveImportMapping(input: {
  tenantId: string;
  actorUserId: string;
  templateId: string;
  name: string;
  mapping: Record<string, string>;
  sourceHeaders: string[];
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const template = await client.query<{ sector_id: string }>(
      `SELECT sector_id FROM templates WHERE id = $1 AND active = true LIMIT 1`,
      [input.templateId],
    );
    const current = template.rows[0];
    if (!current) return { kind: "not_found" as const };
    if (!(await isSectorManager(client, current.sector_id, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const result = await client.query(
      `INSERT INTO import_mappings
        (tenant_id, template_id, name, mapping_json, source_headers, created_by, updated_by)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $6)
       ON CONFLICT (tenant_id, template_id, name)
       DO UPDATE SET
         mapping_json = EXCLUDED.mapping_json,
         source_headers = EXCLUDED.source_headers,
         active = true,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING id, template_id, name, mapping_json, source_headers, active, updated_at`,
      [
        input.tenantId,
        input.templateId,
        input.name,
        JSON.stringify(input.mapping),
        JSON.stringify(input.sourceHeaders),
        input.actorUserId,
      ],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'IMPORT_MAPPING_SAVED', 'import_mapping', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        result.rows[0].id,
        JSON.stringify({ templateId: input.templateId, name: input.name }),
      ],
    );

    return { kind: "saved" as const, mapping: result.rows[0] };
  });
}

export async function listImportMappings(input: {
  tenantId: string;
  actorUserId: string;
  templateId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const access = await client.query<{ sector_id: string }>(
      `SELECT t.sector_id
         FROM templates t
         JOIN memberships m ON m.sector_id = t.sector_id
        WHERE t.id = $1
          AND m.user_id = $2
          AND m.active = true
        LIMIT 1`,
      [input.templateId, input.actorUserId],
    );
    if (!access.rows[0]) return { kind: "forbidden_or_not_found" as const };

    const result = await client.query(
      `SELECT id, name, mapping_json, source_headers, active, updated_at
         FROM import_mappings
        WHERE template_id = $1 AND active = true
        ORDER BY updated_at DESC`,
      [input.templateId],
    );

    return { kind: "ok" as const, mappings: result.rows };
  });
}

export async function loadDefaultImportMapping(
  client: import("../../db.js").DbClient,
  templateVersionId: string | null,
): Promise<Record<string, string>> {
  if (!templateVersionId) return {};

  const result = await client.query<{ mapping_json: Record<string, string> }>(
    `SELECT im.mapping_json
       FROM template_versions tv
       JOIN import_mappings im ON im.template_id = tv.template_id
      WHERE tv.id = $1
        AND im.active = true
      ORDER BY (im.name = 'Padrão') DESC, im.updated_at DESC
      LIMIT 1`,
    [templateVersionId],
  );

  return result.rows[0]?.mapping_json ?? {};
}
