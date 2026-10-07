import { withTenantTransaction } from "../../db.js";
import { isTenantAdmin } from "../../authorization.js";

async function requireAdmin(
  client: import("../../db.js").DbClient,
  tenantId: string,
  userId: string,
) {
  return isTenantAdmin(client, tenantId, userId);
}

export async function getComplianceSettings(input: {
  tenantId: string;
  actorUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await requireAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const result = await client.query(
      `INSERT INTO tenant_compliance_settings (tenant_id)
       VALUES ($1)
       ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
       RETURNING tenant_id, retention_years, default_legal_basis,
                 auto_purge_enabled, dpa_status, dpa_reference, dpa_signed_at, updated_at`,
      [input.tenantId],
    );

    return { kind: "ok" as const, settings: result.rows[0] };
  });
}

export async function updateComplianceSettings(input: {
  tenantId: string;
  actorUserId: string;
  retentionYears: number;
  defaultLegalBasis?: string;
  dpaStatus?: "NOT_CONFIGURED" | "DRAFT" | "SIGNED";
  dpaReference?: string;
  dpaSignedAt?: Date;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await requireAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const before = await client.query<{
      retention_years: number;
      default_legal_basis: string | null;
      dpa_status: "NOT_CONFIGURED" | "DRAFT" | "SIGNED";
      dpa_reference: string | null;
      dpa_signed_at: Date | null;
    }>(
      `SELECT retention_years, default_legal_basis, dpa_status, dpa_reference, dpa_signed_at
         FROM tenant_compliance_settings
        WHERE tenant_id = $1`,
      [input.tenantId],
    );

    const previous = before.rows[0];
    const dpaStatus = input.dpaStatus ?? previous?.dpa_status ?? "NOT_CONFIGURED";
    const dpaReference =
      input.dpaReference !== undefined
        ? input.dpaReference
        : previous?.dpa_reference ?? null;
    const dpaSignedAt =
      dpaStatus === "SIGNED"
        ? input.dpaSignedAt ?? previous?.dpa_signed_at ?? null
        : null;

    if (dpaStatus === "SIGNED" && !dpaSignedAt) {
      return { kind: "invalid_dpa" as const };
    }

    const defaultLegalBasis =
      input.defaultLegalBasis !== undefined
        ? input.defaultLegalBasis
        : previous?.default_legal_basis ?? null;

    const result = await client.query(
      `INSERT INTO tenant_compliance_settings
        (tenant_id, retention_years, default_legal_basis, dpa_status,
         dpa_reference, dpa_signed_at, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (tenant_id)
       DO UPDATE SET
         retention_years = EXCLUDED.retention_years,
         default_legal_basis = EXCLUDED.default_legal_basis,
         dpa_status = EXCLUDED.dpa_status,
         dpa_reference = EXCLUDED.dpa_reference,
         dpa_signed_at = EXCLUDED.dpa_signed_at,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING tenant_id, retention_years, default_legal_basis,
                 auto_purge_enabled, dpa_status, dpa_reference, dpa_signed_at, updated_at`,
      [
        input.tenantId,
        input.retentionYears,
        defaultLegalBasis,
        dpaStatus,
        dpaReference,
        dpaSignedAt,
        input.actorUserId,
      ],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
       VALUES ($1, $2, 'COMPLIANCE_SETTINGS_UPDATED', 'tenant', $1, $3::jsonb, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        JSON.stringify(previous ?? null),
        JSON.stringify(result.rows[0]),
      ],
    );

    return { kind: "updated" as const, settings: result.rows[0] };
  });
}

export async function listRetentionCandidates(input: {
  tenantId: string;
  actorUserId: string;
  limit: number;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await requireAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const settings = await client.query<{ retention_years: number }>(
      `SELECT retention_years
         FROM tenant_compliance_settings
        WHERE tenant_id = $1`,
      [input.tenantId],
    );
    const retentionYears = settings.rows[0]?.retention_years ?? 5;

    const result = await client.query(
      `SELECT r.id, r.title, r.status, r.competence, r.updated_at,
              r.origin_sector_id, r.destination_sector_id
         FROM requests r
        WHERE r.status IN ('CLOSED', 'CANCELLED')
          AND r.updated_at <= now() - make_interval(years => $1)
        ORDER BY r.updated_at ASC
        LIMIT $2`,
      [retentionYears, input.limit],
    );

    return {
      kind: "ok" as const,
      retentionYears,
      data: result.rows,
    };
  });
}

export async function createDataSubjectRequest(input: {
  tenantId: string;
  actorUserId: string;
  subjectUserId: string;
  requestType: "ACCESS" | "CORRECTION" | "ERASURE" | "RESTRICTION";
  reason?: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await requireAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const subject = await client.query(
      `SELECT 1
         FROM tenant_users
        WHERE tenant_id = $1
          AND user_id = $2
        LIMIT 1`,
      [input.tenantId, input.subjectUserId],
    );
    if (subject.rowCount !== 1) return { kind: "subject_not_found" as const };

    const result = await client.query(
      `INSERT INTO data_subject_requests
        (tenant_id, subject_user_id, request_type, reason, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, subject_user_id, request_type, status, reason, created_at`,
      [
        input.tenantId,
        input.subjectUserId,
        input.requestType,
        input.reason ?? null,
        input.actorUserId,
      ],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'DATA_SUBJECT_REQUEST_CREATED', 'data_subject_request', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        result.rows[0].id,
        JSON.stringify({
          subjectUserId: input.subjectUserId,
          requestType: input.requestType,
        }),
      ],
    );

    return { kind: "created" as const, request: result.rows[0] };
  });
}

export async function listDataSubjectRequests(input: {
  tenantId: string;
  actorUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await requireAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const result = await client.query(
      `SELECT dsr.id, dsr.subject_user_id, u.name AS subject_name, u.email AS subject_email,
              dsr.request_type, dsr.status, dsr.reason, dsr.resolution,
              dsr.created_at, dsr.updated_at, dsr.completed_at
         FROM data_subject_requests dsr
         JOIN users u ON u.id = dsr.subject_user_id
        ORDER BY dsr.created_at DESC`,
    );

    return { kind: "ok" as const, data: result.rows };
  });
}

export async function updateDataSubjectRequest(input: {
  tenantId: string;
  actorUserId: string;
  requestId: string;
  status: "OPEN" | "IN_REVIEW" | "COMPLETED" | "REJECTED";
  resolution?: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await requireAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const current = await client.query(
      `SELECT status, resolution
         FROM data_subject_requests
        WHERE id = $1
        FOR UPDATE`,
      [input.requestId],
    );
    if (!current.rows[0]) return { kind: "not_found" as const };

    const currentStatus = current.rows[0].status as string;
    if (["COMPLETED", "REJECTED"].includes(currentStatus) && input.status !== currentStatus) {
      return { kind: "terminal_state" as const, status: currentStatus };
    }

    const completed = ["COMPLETED", "REJECTED"].includes(input.status);
    if (completed && !input.resolution?.trim()) {
      return { kind: "resolution_required" as const };
    }

    const result = await client.query(
      `UPDATE data_subject_requests
          SET status = $2,
              resolution = $3,
              updated_at = now(),
              completed_at = CASE WHEN $4 THEN now() ELSE NULL END
        WHERE id = $1
       RETURNING id, subject_user_id, request_type, status, reason, resolution,
                 created_at, updated_at, completed_at`,
      [input.requestId, input.status, input.resolution ?? null, completed],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
       VALUES ($1, $2, 'DATA_SUBJECT_REQUEST_UPDATED', 'data_subject_request', $3, $4::jsonb, $5::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.requestId,
        JSON.stringify(current.rows[0]),
        JSON.stringify(result.rows[0]),
      ],
    );

    return { kind: "updated" as const, request: result.rows[0] };
  });
}

export async function exportDataSubject(input: {
  tenantId: string;
  actorUserId: string;
  subjectUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await requireAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const user = await client.query(
      `SELECT u.id, u.name, u.email, u.active, u.created_at,
              tu.role AS tenant_role, tu.active AS tenant_active
         FROM users u
         JOIN tenant_users tu ON tu.user_id = u.id
        WHERE tu.tenant_id = $1
          AND u.id = $2
        LIMIT 1`,
      [input.tenantId, input.subjectUserId],
    );
    if (!user.rows[0]) return { kind: "not_found" as const };

    const memberships = await client.query(
      `SELECT m.id, m.sector_id, s.name AS sector_name, m.role, m.active, m.created_at
         FROM memberships m
         JOIN sectors s ON s.id = m.sector_id
        WHERE m.user_id = $1
        ORDER BY s.name`,
      [input.subjectUserId],
    );

    const requests = await client.query(
      `SELECT id, title, status, competence, due_at, created_at, updated_at,
              created_by, assigned_to
         FROM requests
        WHERE created_by = $1 OR assigned_to = $1
        ORDER BY created_at DESC`,
      [input.subjectUserId],
    );

    const itemActivity = await client.query(
      `SELECT id, request_id, item_key, status, last_edited_by,
              submitted_by, submitted_at, reviewed_by, reviewed_at, updated_at
         FROM request_items
        WHERE last_edited_by = $1
           OR submitted_by = $1
           OR reviewed_by = $1
        ORDER BY updated_at DESC`,
      [input.subjectUserId],
    );

    const comments = await client.query(
      `SELECT id, request_id, item_id, field_key, text, created_at
         FROM comments
        WHERE author_user_id = $1
        ORDER BY created_at DESC`,
      [input.subjectUserId],
    );

    const attachments = await client.query(
      `SELECT id, request_id, item_id, filename, mime_type, size_bytes, sha256, created_at
         FROM attachments
        WHERE uploaded_by = $1
        ORDER BY created_at DESC`,
      [input.subjectUserId],
    );

    const auditEvents = await client.query(
      `SELECT id, action, entity_type, entity_id, created_at
         FROM audit_events
        WHERE actor_user_id = $1
        ORDER BY created_at DESC`,
      [input.subjectUserId],
    );

    const exported = {
      exportedAt: new Date().toISOString(),
      tenantId: input.tenantId,
      subject: user.rows[0],
      memberships: memberships.rows,
      requests: requests.rows,
      itemActivity: itemActivity.rows,
      comments: comments.rows,
      attachments: attachments.rows,
      auditEvents: auditEvents.rows,
    };

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'DATA_SUBJECT_EXPORT_GENERATED', 'user', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.subjectUserId,
        JSON.stringify({
          memberships: memberships.rowCount,
          requests: requests.rowCount,
          itemActivity: itemActivity.rowCount,
          comments: comments.rowCount,
          attachments: attachments.rowCount,
          auditEvents: auditEvents.rowCount,
        }),
      ],
    );

    return { kind: "ok" as const, data: exported };
  });
}


export async function listProcessingActivities(input: {
  tenantId: string;
  actorUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await requireAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const result = await client.query(
      `SELECT id, name, purpose, legal_basis, data_categories, subject_categories,
              processors, retention_years, active, created_at, updated_at
         FROM data_processing_activities
        ORDER BY active DESC, name ASC`,
    );

    return { kind: "ok" as const, data: result.rows };
  });
}

export async function createProcessingActivity(input: {
  tenantId: string;
  actorUserId: string;
  name: string;
  purpose: string;
  legalBasis: string;
  dataCategories: string[];
  subjectCategories: string[];
  processors: string[];
  retentionYears?: number;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await requireAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const result = await client.query(
      `INSERT INTO data_processing_activities
        (tenant_id, name, purpose, legal_basis, data_categories, subject_categories,
         processors, retention_years, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5::text[], $6::text[], $7::text[], $8, $9, $9)
       RETURNING id, name, purpose, legal_basis, data_categories, subject_categories,
                 processors, retention_years, active, created_at, updated_at`,
      [
        input.tenantId,
        input.name,
        input.purpose,
        input.legalBasis,
        input.dataCategories,
        input.subjectCategories,
        input.processors,
        input.retentionYears ?? null,
        input.actorUserId,
      ],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'PROCESSING_ACTIVITY_CREATED', 'processing_activity', $3, $4::jsonb)`,
      [input.tenantId, input.actorUserId, result.rows[0].id, JSON.stringify(result.rows[0])],
    );

    return { kind: "created" as const, activity: result.rows[0] };
  });
}

export async function updateProcessingActivity(input: {
  tenantId: string;
  actorUserId: string;
  activityId: string;
  name: string;
  purpose: string;
  legalBasis: string;
  dataCategories: string[];
  subjectCategories: string[];
  processors: string[];
  retentionYears?: number;
  active: boolean;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await requireAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const before = await client.query(
      `SELECT id, name, purpose, legal_basis, data_categories, subject_categories,
              processors, retention_years, active
         FROM data_processing_activities
        WHERE id = $1
        FOR UPDATE`,
      [input.activityId],
    );
    if (!before.rows[0]) return { kind: "not_found" as const };

    const result = await client.query(
      `UPDATE data_processing_activities
          SET name = $2,
              purpose = $3,
              legal_basis = $4,
              data_categories = $5::text[],
              subject_categories = $6::text[],
              processors = $7::text[],
              retention_years = $8,
              active = $9,
              updated_by = $10,
              updated_at = now()
        WHERE id = $1
       RETURNING id, name, purpose, legal_basis, data_categories, subject_categories,
                 processors, retention_years, active, created_at, updated_at`,
      [
        input.activityId,
        input.name,
        input.purpose,
        input.legalBasis,
        input.dataCategories,
        input.subjectCategories,
        input.processors,
        input.retentionYears ?? null,
        input.active,
        input.actorUserId,
      ],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
       VALUES ($1, $2, 'PROCESSING_ACTIVITY_UPDATED', 'processing_activity', $3, $4::jsonb, $5::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.activityId,
        JSON.stringify(before.rows[0]),
        JSON.stringify(result.rows[0]),
      ],
    );

    return { kind: "updated" as const, activity: result.rows[0] };
  });
}
