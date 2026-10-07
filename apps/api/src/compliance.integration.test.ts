import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const { Client } = pg;
const adminUrl = process.env.MIGRATION_DATABASE_URL;
const appUrl = process.env.DATABASE_URL;
const enabled = Boolean(adminUrl && appUrl);
const suite = enabled ? describe : describe.skip;

suite("LGPD and retention", () => {
  let admin: pg.Client;
  let tenantId = "";
  let adminUserId = "";
  let subjectUserId = "";
  let originSectorId = "";
  let destinationSectorId = "";

  let getComplianceSettings: typeof import("./modules/tenancy/compliance.service.js").getComplianceSettings;
  let updateComplianceSettings: typeof import("./modules/tenancy/compliance.service.js").updateComplianceSettings;
  let listRetentionCandidates: typeof import("./modules/tenancy/compliance.service.js").listRetentionCandidates;
  let createDataSubjectRequest: typeof import("./modules/tenancy/compliance.service.js").createDataSubjectRequest;
  let updateDataSubjectRequest: typeof import("./modules/tenancy/compliance.service.js").updateDataSubjectRequest;
  let exportDataSubject: typeof import("./modules/tenancy/compliance.service.js").exportDataSubject;
  let createProcessingActivity: typeof import("./modules/tenancy/compliance.service.js").createProcessingActivity;
  let listProcessingActivities: typeof import("./modules/tenancy/compliance.service.js").listProcessingActivities;
  let updateProcessingActivity: typeof import("./modules/tenancy/compliance.service.js").updateProcessingActivity;

  beforeAll(async () => {
    if (!enabled) return;

    process.env.JWT_SECRET ??= "test-jwt-secret-".padEnd(40, "x");
    process.env.OBJECT_STORAGE_ACCESS_KEY ??= "test-access";
    process.env.OBJECT_STORAGE_SECRET_KEY ??= "test-secret";
    process.env.MFA_ENCRYPTION_KEY ??= "11".repeat(32);
    process.env.PLATFORM_ADMIN_KEY ??= "test-platform-admin-key".padEnd(40, "x");
    process.env.INTEGRATION_ENCRYPTION_KEY ??= "22".repeat(32);
    process.env.CLAMAV_ENABLED = "false";
    process.env.NODE_ENV = "test";

    ({
      getComplianceSettings,
      updateComplianceSettings,
      listRetentionCandidates,
      createDataSubjectRequest,
      updateDataSubjectRequest,
      exportDataSubject,
      createProcessingActivity,
      listProcessingActivities,
      updateProcessingActivity,
    } = await import("./modules/tenancy/compliance.service.js"));

    admin = new Client({ connectionString: adminUrl! });
    await admin.connect();

    const tenant = await admin.query<{ id: string }>(
      `INSERT INTO tenants (name, subdomain)
       VALUES ('Compliance Test', 'compliance-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
    );
    tenantId = tenant.rows[0]!.id;

    const users = await admin.query<{ id: string }>(
      `INSERT INTO users (email, name)
       VALUES
         ('compliance-admin-' || substr(gen_random_uuid()::text, 1, 8) || '@example.test', 'Compliance Admin'),
         ('data-subject-' || substr(gen_random_uuid()::text, 1, 8) || '@example.test', 'Data Subject')
       RETURNING id`,
    );
    adminUserId = users.rows[0]!.id;
    subjectUserId = users.rows[1]!.id;

    await admin.query(
      `INSERT INTO tenant_users (tenant_id, user_id, role)
       VALUES ($1, $2, 'ADMIN'), ($1, $3, 'USER')`,
      [tenantId, adminUserId, subjectUserId],
    );

    const sectors = await admin.query<{ id: string; name: string }>(
      `INSERT INTO sectors (tenant_id, name)
       VALUES ($1, 'Controladoria'), ($1, 'Compras')
       RETURNING id, name`,
      [tenantId],
    );
    originSectorId = sectors.rows.find((row) => row.name === "Controladoria")!.id;
    destinationSectorId = sectors.rows.find((row) => row.name === "Compras")!.id;

    await admin.query(
      `INSERT INTO memberships (tenant_id, sector_id, user_id, role)
       VALUES ($1, $2, $3, 'MEMBER')`,
      [tenantId, destinationSectorId, subjectUserId],
    );

    await admin.query(
      `INSERT INTO requests
        (tenant_id, origin_sector_id, destination_sector_id, created_by, assigned_to,
         title, due_at, status, competence, created_at, updated_at)
       VALUES
        ($1, $2, $3, $4, $4, 'Solicitação antiga', now() - interval '3 years',
         'CLOSED', '2023-01', now() - interval '3 years', now() - interval '2 years'),
        ($1, $2, $3, $4, $4, 'Solicitação recente', now() + interval '7 days',
         'OPEN', '2026-10', now(), now())`,
      [tenantId, originSectorId, destinationSectorId, subjectUserId],
    );
  });

  afterAll(async () => {
    if (admin) await admin.end();
  });

  it("uses five years by default and lets admin configure retention", async () => {
    const current = await getComplianceSettings({
      tenantId,
      actorUserId: adminUserId,
    });

    expect(current.kind).toBe("ok");
    if (current.kind !== "ok") return;
    expect(current.settings.retention_years).toBe(5);

    const invalidDpa = await updateComplianceSettings({
      tenantId,
      actorUserId: adminUserId,
      retentionYears: 1,
      defaultLegalBasis: "Execução contratual e obrigação legal aplicável.",
      dpaStatus: "SIGNED",
    });
    expect(invalidDpa.kind).toBe("invalid_dpa");

    const signedAt = new Date();
    const updated = await updateComplianceSettings({
      tenantId,
      actorUserId: adminUserId,
      retentionYears: 1,
      defaultLegalBasis: "Execução contratual e obrigação legal aplicável.",
      dpaStatus: "SIGNED",
      dpaReference: "DPA-2026-001",
      dpaSignedAt: signedAt,
    });

    expect(updated.kind).toBe("updated");
    if (updated.kind !== "updated") return;
    expect(updated.settings.retention_years).toBe(1);
    expect(updated.settings.dpa_status).toBe("SIGNED");
    expect(updated.settings.dpa_reference).toBe("DPA-2026-001");
  });

  it("reports only closed/cancelled records older than the retention window", async () => {
    const candidates = await listRetentionCandidates({
      tenantId,
      actorUserId: adminUserId,
      limit: 100,
    });

    expect(candidates.kind).toBe("ok");
    if (candidates.kind !== "ok") return;

    expect(candidates.retentionYears).toBe(1);
    expect(candidates.data).toHaveLength(1);
    expect(candidates.data[0]!.title).toBe("Solicitação antiga");
    expect(candidates.data[0]!.status).toBe("CLOSED");
  });


  it("maintains a tenant processing-activity register", async () => {
    const created = await createProcessingActivity({
      tenantId,
      actorUserId: adminUserId,
      name: "Gestão de solicitações interdepartamentais",
      purpose: "Coletar, revisar e auditar informações entre áreas.",
      legalBasis: "Execução contratual e legítimo interesse avaliado pelo controlador.",
      dataCategories: ["identificação", "dados profissionais"],
      subjectCategories: ["colaboradores"],
      processors: ["Handoff"],
      retentionYears: 5,
    });

    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;

    const listed = await listProcessingActivities({
      tenantId,
      actorUserId: adminUserId,
    });
    expect(listed.kind).toBe("ok");
    if (listed.kind !== "ok") return;
    expect(listed.data.some((item) => item.id === created.activity.id)).toBe(true);

    const updated = await updateProcessingActivity({
      tenantId,
      actorUserId: adminUserId,
      activityId: created.activity.id as string,
      name: "Gestão de solicitações entre áreas",
      purpose: "Coletar, revisar, aprovar e auditar informações entre áreas.",
      legalBasis: "Execução contratual e obrigação legal aplicável.",
      dataCategories: ["identificação", "dados profissionais", "evidências"],
      subjectCategories: ["colaboradores", "fornecedores"],
      processors: ["Handoff", "OCI"],
      retentionYears: 5,
      active: true,
    });

    expect(updated.kind).toBe("updated");
    if (updated.kind !== "updated") return;
    expect(updated.activity.processors).toContain("OCI");
  });

  it("creates, exports and completes a data-subject request with audit trail", async () => {
    const created = await createDataSubjectRequest({
      tenantId,
      actorUserId: adminUserId,
      subjectUserId,
      requestType: "ACCESS",
      reason: "Solicitação de acesso do titular.",
    });

    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;

    const exported = await exportDataSubject({
      tenantId,
      actorUserId: adminUserId,
      subjectUserId,
    });

    expect(exported.kind).toBe("ok");
    if (exported.kind !== "ok") return;

    expect(exported.data.subject.id).toBe(subjectUserId);
    expect(exported.data.memberships.length).toBeGreaterThanOrEqual(1);
    expect(exported.data.requests.length).toBe(2);

    const completed = await updateDataSubjectRequest({
      tenantId,
      actorUserId: adminUserId,
      requestId: created.request.id as string,
      status: "COMPLETED",
      resolution: "Exportação entregue ao titular.",
    });

    expect(completed.kind).toBe("updated");
    if (completed.kind !== "updated") return;
    expect(completed.request.status).toBe("COMPLETED");
    expect(completed.request.completed_at).not.toBeNull();

    const reopen = await updateDataSubjectRequest({
      tenantId,
      actorUserId: adminUserId,
      requestId: created.request.id as string,
      status: "IN_REVIEW",
      resolution: "Tentativa inválida de reabertura.",
    });
    expect(reopen.kind).toBe("terminal_state");

    const audit = await admin.query<{ action: string }>(
      `SELECT action
         FROM audit_events
        WHERE tenant_id = $1
          AND action IN (
            'DATA_SUBJECT_REQUEST_CREATED',
            'DATA_SUBJECT_EXPORT_GENERATED',
            'DATA_SUBJECT_REQUEST_UPDATED'
          )
        ORDER BY chain_seq`,
      [tenantId],
    );

    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "DATA_SUBJECT_REQUEST_CREATED",
        "DATA_SUBJECT_EXPORT_GENERATED",
        "DATA_SUBJECT_REQUEST_UPDATED",
      ]),
    );
  });
});
