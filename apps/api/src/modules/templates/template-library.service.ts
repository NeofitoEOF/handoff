import { withTenantTransaction } from "../../db.js";
import { isSectorManager } from "../../authorization.js";

export async function listTemplateLibrary() {
  const { pool } = await import("../../db.js");
  const result = await pool.query(
    `SELECT id, code, name, sector_hint, description, schema_json
       FROM template_library
      WHERE active = true
      ORDER BY sector_hint, name`,
  );
  return result.rows;
}

export async function cloneLibraryTemplate(input: {
  tenantId: string;
  actorUserId: string;
  sectorId: string;
  libraryId: string;
  name?: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await isSectorManager(client, input.sectorId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const library = await client.query<{
      name: string;
      description: string | null;
      schema_json: unknown;
    }>(
      `SELECT name, description, schema_json
         FROM template_library
        WHERE id = $1 AND active = true`,
      [input.libraryId],
    );
    const source = library.rows[0];
    if (!source) return { kind: "not_found" as const };

    const template = await client.query<{ id: string }>(
      `INSERT INTO templates (tenant_id, sector_id, name, description, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        input.tenantId,
        input.sectorId,
        input.name ?? source.name,
        source.description,
        input.actorUserId,
      ],
    );
    const templateId = template.rows[0]!.id;

    const version = await client.query(
      `INSERT INTO template_versions
        (tenant_id, template_id, version, schema_json, created_by)
       VALUES ($1, $2, 1, $3::jsonb, $4)
       RETURNING id, template_id, version, schema_json, status, created_at`,
      [input.tenantId, templateId, JSON.stringify(source.schema_json), input.actorUserId],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'TEMPLATE_LIBRARY_CLONED', 'template', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        templateId,
        JSON.stringify({ libraryId: input.libraryId }),
      ],
    );

    return { kind: "cloned" as const, version: version.rows[0] };
  });
}
