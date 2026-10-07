import { withTenantTransaction } from "../../db.js";
import { isSectorManager } from "../../authorization.js";

export type TemplateSchema = {
  fields: Array<{
    key: string;
    label: string;
    type: "TEXT" | "NUMBER" | "MONEY" | "DATE" | "CPF" | "CNPJ" | "SELECT" | "BOOLEAN" | "ATTACHMENT";
    required?: boolean | undefined;
    min?: number | undefined;
    max?: number | undefined;
    regex?: string | undefined;
    options?: string[] | undefined;
    calculation?:
      | { op: "ADD" | "SUBTRACT" | "MULTIPLY"; fields: string[] }
      | { op: "PERCENT"; valueField: string; percentField: string }
      | { op: "COLUMN_SUM"; field: string }
      | undefined;
  }>;
};

export async function createTemplate(input: {
  tenantId: string;
  actorUserId: string;
  sectorId: string;
  name: string;
  description?: string;
  schema: TemplateSchema;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await isSectorManager(client, input.sectorId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const template = await client.query<{ id: string }>(
      `INSERT INTO templates (tenant_id, sector_id, name, description, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [input.tenantId, input.sectorId, input.name, input.description ?? null, input.actorUserId],
    );
    const templateId = template.rows[0]!.id;

    const version = await client.query(
      `INSERT INTO template_versions
        (tenant_id, template_id, version, schema_json, created_by)
       VALUES ($1, $2, 1, $3::jsonb, $4)
       RETURNING id, template_id, version, schema_json, status, created_at`,
      [input.tenantId, templateId, JSON.stringify(input.schema), input.actorUserId],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'TEMPLATE_CREATED', 'template', $3, $4::jsonb)`,
      [input.tenantId, input.actorUserId, templateId, JSON.stringify({ name: input.name, version: 1 })],
    );

    return { kind: "created" as const, version: version.rows[0] };
  });
}

export async function createTemplateVersion(input: {
  tenantId: string;
  actorUserId: string;
  templateId: string;
  schema: TemplateSchema;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const template = await client.query<{ sector_id: string; active: boolean }>(
      `SELECT sector_id, active FROM templates WHERE id = $1 FOR UPDATE`,
      [input.templateId],
    );
    const current = template.rows[0];
    if (!current) return { kind: "not_found" as const };
    if (!current.active) return { kind: "inactive" as const };
    if (!(await isSectorManager(client, current.sector_id, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const maxVersion = await client.query<{ max_version: number | null }>(
      `SELECT max(version)::int AS max_version FROM template_versions WHERE template_id = $1`,
      [input.templateId],
    );
    const nextVersion = (maxVersion.rows[0]?.max_version ?? 0) + 1;

    const result = await client.query(
      `INSERT INTO template_versions
        (tenant_id, template_id, version, schema_json, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id, template_id, version, schema_json, status, created_at`,
      [input.tenantId, input.templateId, nextVersion, JSON.stringify(input.schema), input.actorUserId],
    );

    return { kind: "created" as const, version: result.rows[0] };
  });
}

export async function publishTemplateVersion(input: {
  tenantId: string;
  actorUserId: string;
  templateId: string;
  versionId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const template = await client.query<{ sector_id: string }>(
      `SELECT sector_id FROM templates WHERE id = $1`,
      [input.templateId],
    );
    const current = template.rows[0];
    if (!current) return { kind: "not_found" as const };
    if (!(await isSectorManager(client, current.sector_id, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const version = await client.query<{ id: string; status: string }>(
      `SELECT id, status
         FROM template_versions
        WHERE id = $1 AND template_id = $2
        FOR UPDATE`,
      [input.versionId, input.templateId],
    );
    const v = version.rows[0];
    if (!v) return { kind: "version_not_found" as const };
    if (v.status === "PUBLISHED") return { kind: "already_published" as const };

    // Published rows become immutable after this single controlled transition.
    await client.query(
      `UPDATE template_versions
          SET status = 'PUBLISHED', published_at = now()
        WHERE id = $1`,
      [input.versionId],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'TEMPLATE_VERSION_PUBLISHED', 'template_version', $3, $4::jsonb)`,
      [input.tenantId, input.actorUserId, input.versionId, JSON.stringify({ status: "PUBLISHED" })],
    );

    return { kind: "published" as const };
  });
}

export async function listTemplates(input: {
  tenantId: string;
  sectorId: string;
  actorUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const access = await client.query(
      `SELECT 1 FROM memberships
        WHERE sector_id = $1 AND user_id = $2 AND active = true LIMIT 1`,
      [input.sectorId, input.actorUserId],
    );
    if (access.rowCount !== 1) return { kind: "forbidden" as const };

    const result = await client.query(
      `SELECT t.id, t.name, t.description, t.active,
              tv.id AS published_version_id, tv.version AS published_version
         FROM templates t
         LEFT JOIN LATERAL (
           SELECT id, version
             FROM template_versions
            WHERE template_id = t.id AND status = 'PUBLISHED'
            ORDER BY version DESC
            LIMIT 1
         ) tv ON true
        WHERE t.sector_id = $1
        ORDER BY t.name`,
      [input.sectorId],
    );

    return { kind: "ok" as const, templates: result.rows };
  });
}


export async function getTemplateDetail(input: {
  tenantId: string;
  actorUserId: string;
  templateId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const template = await client.query<{
      id: string;
      sector_id: string;
      name: string;
      description: string | null;
      active: boolean;
    }>(
      `SELECT id, sector_id, name, description, active
         FROM templates
        WHERE id = $1`,
      [input.templateId],
    );
    const current = template.rows[0];
    if (!current) return { kind: "not_found" as const };

    const access = await client.query(
      `SELECT 1 FROM memberships
        WHERE sector_id = $1 AND user_id = $2 AND active = true LIMIT 1`,
      [current.sector_id, input.actorUserId],
    );
    if (access.rowCount !== 1) return { kind: "forbidden" as const };

    const versions = await client.query(
      `SELECT id, version, schema_json, status, created_by, created_at, published_at
         FROM template_versions
        WHERE template_id = $1
        ORDER BY version DESC`,
      [input.templateId],
    );

    return { kind: "ok" as const, template: current, versions: versions.rows };
  });
}

export async function updateDraftTemplateVersion(input: {
  tenantId: string;
  actorUserId: string;
  templateId: string;
  versionId: string;
  schema: TemplateSchema;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const template = await client.query<{ sector_id: string }>(
      `SELECT sector_id FROM templates WHERE id = $1`,
      [input.templateId],
    );
    const current = template.rows[0];
    if (!current) return { kind: "not_found" as const };
    if (!(await isSectorManager(client, current.sector_id, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const version = await client.query<{ status: string }>(
      `SELECT status
         FROM template_versions
        WHERE id = $1 AND template_id = $2
        FOR UPDATE`,
      [input.versionId, input.templateId],
    );
    const draft = version.rows[0];
    if (!draft) return { kind: "version_not_found" as const };
    if (draft.status !== "DRAFT") return { kind: "immutable" as const };

    const result = await client.query(
      `UPDATE template_versions
          SET schema_json = $3::jsonb
        WHERE id = $1 AND template_id = $2
       RETURNING id, version, schema_json, status`,
      [input.versionId, input.templateId, JSON.stringify(input.schema)],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'TEMPLATE_DRAFT_UPDATED', 'template_version', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.versionId,
        JSON.stringify({ fieldCount: input.schema.fields.length }),
      ],
    );

    return { kind: "updated" as const, version: result.rows[0] };
  });
}
