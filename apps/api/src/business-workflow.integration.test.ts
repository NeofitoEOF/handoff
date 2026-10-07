import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const { Client } = pg;

const adminUrl = process.env.MIGRATION_DATABASE_URL;
const appUrl = process.env.DATABASE_URL;
const enabled = Boolean(adminUrl && appUrl);
const suite = enabled ? describe : describe.skip;

suite("business workflow acceptance", () => {
  let admin: pg.Client;
  let tenantId = "";
  let originSectorId = "";
  let destinationSectorId = "";
  let creatorId = "";
  let originApproverId = "";
  let destinationManagerId = "";
  let assigneeAId = "";
  let assigneeBId = "";

  let createRequest: typeof import("./modules/requests/request-create.service.js").createRequest;
  let assignRequest: typeof import("./modules/requests/request-assignment.service.js").assignRequest;
  let reassignRequest: typeof import("./modules/requests/request.service.js").reassignRequest;
  let upsertRequestItem: typeof import("./modules/items/item.service.js").upsertRequestItem;
  let submitRequestItems: typeof import("./modules/items/item.service.js").submitRequestItems;
  let approveItem: typeof import("./modules/reviews/review.service.js").approveItem;
  let returnItem: typeof import("./modules/reviews/review.service.js").returnItem;
  let closeRequest: typeof import("./modules/closing/closing.service.js").closeRequest;
  let createRetification: typeof import("./modules/closing/closing.service.js").createRetification;
  let deactivateSectorMember: typeof import("./modules/sectors/sector.service.js").deactivateSectorMember;
  let changeRequestDueDate: typeof import("./modules/requests/request-operations.service.js").changeRequestDueDate;
  let cancelRequest: typeof import("./modules/requests/request-operations.service.js").cancelRequest;

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

    ({ createRequest } = await import("./modules/requests/request-create.service.js"));
    ({ assignRequest } = await import("./modules/requests/request-assignment.service.js"));
    ({ reassignRequest } = await import("./modules/requests/request.service.js"));
    ({ upsertRequestItem, submitRequestItems } = await import("./modules/items/item.service.js"));
    ({ approveItem, returnItem } = await import("./modules/reviews/review.service.js"));
    ({ closeRequest, createRetification } = await import("./modules/closing/closing.service.js"));
    ({ deactivateSectorMember } = await import("./modules/sectors/sector.service.js"));
    ({ changeRequestDueDate, cancelRequest } = await import("./modules/requests/request-operations.service.js"));

    admin = new Client({ connectionString: adminUrl! });
    await admin.connect();

    const tenant = await admin.query<{ id: string }>(
      `INSERT INTO tenants (name, subdomain)
       VALUES ('Acceptance Company', 'accept-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
    );
    tenantId = tenant.rows[0]!.id;

    const users = await admin.query<{ id: string; email: string }>(
      `INSERT INTO users (email, name)
       VALUES
         ('creator-' || substr(gen_random_uuid()::text, 1, 8) || '@example.test', 'Creator'),
         ('approver-' || substr(gen_random_uuid()::text, 1, 8) || '@example.test', 'Origin Approver'),
         ('manager-' || substr(gen_random_uuid()::text, 1, 8) || '@example.test', 'Destination Manager'),
         ('assignee-a-' || substr(gen_random_uuid()::text, 1, 8) || '@example.test', 'Assignee A'),
         ('assignee-b-' || substr(gen_random_uuid()::text, 1, 8) || '@example.test', 'Assignee B')
       RETURNING id, email`,
    );
    [creatorId, originApproverId, destinationManagerId, assigneeAId, assigneeBId] =
      users.rows.map((row) => row.id);

    await admin.query(
      `INSERT INTO tenant_users (tenant_id, user_id, role)
       SELECT $1, unnest($2::uuid[]), 'USER'::tenant_role`,
      [tenantId, [creatorId, originApproverId, destinationManagerId, assigneeAId, assigneeBId]],
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
       VALUES
         ($1, $2, $4, 'MEMBER'),
         ($1, $2, $5, 'APPROVER'),
         ($1, $2, $7, 'APPROVER'),
         ($1, $3, $6, 'MANAGER'),
         ($1, $3, $7, 'MEMBER'),
         ($1, $3, $8, 'MEMBER')`,
      [
        tenantId,
        originSectorId,
        destinationSectorId,
        creatorId,
        originApproverId,
        destinationManagerId,
        assigneeAId,
        assigneeBId,
      ],
    );
  });

  afterAll(async () => {
    if (admin) await admin.end();
  });

  it("executes create -> assign -> reassign -> partial review -> correction -> approval -> close -> retification", async () => {
    const originalDueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const created = await createRequest({
      tenantId,
      actorUserId: creatorId,
      originSectorId,
      destinationSectorId,
      title: "Provisões de fechamento",
      competence: "2026-10",
      dueAt: originalDueAt,
      instructions: "Preencher os valores e anexar evidências.",
    });

    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;
    const requestId = created.request.id as string;
    expect(created.request.status).toBe("OPEN");

    const assigned = await assignRequest({
      tenantId,
      requestId,
      actorUserId: destinationManagerId,
      assigneeUserId: assigneeAId,
    });
    expect(assigned.kind).toBe("assigned");

    const reassigned = await reassignRequest({
      tenantId,
      requestId,
      actorUserId: destinationManagerId,
      newAssigneeUserId: assigneeBId,
      reason: "ABSENCE",
      comment: "Responsável anterior entrou de férias.",
    });
    expect(reassigned.kind).toBe("reassigned");

    const afterReassignment = await admin.query<{
      assigned_to: string;
      due_at: Date;
      status: string;
    }>(
      `SELECT assigned_to, due_at, status FROM requests WHERE id = $1`,
      [requestId],
    );
    expect(afterReassignment.rows[0]!.assigned_to).toBe(assigneeBId);
    expect(afterReassignment.rows[0]!.status).toBe("IN_PROGRESS");
    expect(afterReassignment.rows[0]!.due_at.toISOString()).toBe(originalDueAt.toISOString());

    const first = await upsertRequestItem({
      tenantId,
      requestId,
      actorUserId: assigneeBId,
      itemKey: "NF-001",
      data: { documento: "NF-001", valor: 1000 },
    });
    const second = await upsertRequestItem({
      tenantId,
      requestId,
      actorUserId: assigneeBId,
      itemKey: "NF-002",
      data: { documento: "NF-002", valor: 2000 },
    });
    expect(first.kind).toBe("saved");
    expect(second.kind).toBe("saved");
    if (first.kind !== "saved" || second.kind !== "saved") return;

    const submitted = await submitRequestItems({
      tenantId,
      requestId,
      actorUserId: assigneeBId,
    });
    expect(submitted.kind).toBe("submitted");

    const makerCheckerBlocked = await approveItem({
      tenantId,
      requestId,
      itemId: first.item.id as string,
      actorUserId: assigneeBId,
    });
    expect(makerCheckerBlocked.kind).toBe("maker_checker");

    const approvedFirst = await approveItem({
      tenantId,
      requestId,
      itemId: first.item.id as string,
      actorUserId: originApproverId,
    });
    expect(approvedFirst.kind).toBe("approved");
    if (approvedFirst.kind === "approved") {
      expect(approvedFirst.requestStatus).toBe("IN_REVIEW");
    }

    const correctionDueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const returnedSecond = await returnItem({
      tenantId,
      requestId,
      itemId: second.item.id as string,
      actorUserId: originApproverId,
      comment: "Valor divergente do relatório.",
      correctionDueAt,
    });
    expect(returnedSecond.kind).toBe("returned");
    if (returnedSecond.kind === "returned") {
      expect(returnedSecond.requestStatus).toBe("IN_CORRECTION");
    }

    const approvedItemAfterPartial = await admin.query<{ status: string }>(
      `SELECT status FROM request_items WHERE id = $1`,
      [first.item.id],
    );
    expect(approvedItemAfterPartial.rows[0]!.status).toBe("APPROVED");

    const corrected = await upsertRequestItem({
      tenantId,
      requestId,
      actorUserId: assigneeBId,
      itemKey: "NF-002",
      data: { documento: "NF-002", valor: 2200 },
    });
    expect(corrected.kind).toBe("saved");

    const resubmitted = await submitRequestItems({
      tenantId,
      requestId,
      actorUserId: assigneeBId,
    });
    expect(resubmitted.kind).toBe("submitted");

    const approvedSecond = await approveItem({
      tenantId,
      requestId,
      itemId: second.item.id as string,
      actorUserId: originApproverId,
    });
    expect(approvedSecond.kind).toBe("approved");
    if (approvedSecond.kind === "approved") {
      expect(approvedSecond.requestStatus).toBe("APPROVED");
    }

    const closed = await closeRequest({
      tenantId,
      requestId,
      actorUserId: originApproverId,
    });
    expect(closed.kind).toBe("closed");

    const original = await admin.query<{ status: string }>(
      `SELECT status FROM requests WHERE id = $1`,
      [requestId],
    );
    expect(original.rows[0]!.status).toBe("CLOSED");

    const retification = await createRetification({
      tenantId,
      originalRequestId: requestId,
      actorUserId: originApproverId,
      dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      reason: "Documento complementar recebido após o fechamento.",
    });
    expect(retification.kind).toBe("created");
    if (retification.kind === "created") {
      expect(retification.request.status).toBe("OPEN");
      expect(retification.request.retifies_request_id).toBe(requestId);
    }
  });

  it("moves pending work to WAITING_REASSIGNMENT when the current assignee is deactivated", async () => {
    const originalDueAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

    const created = await createRequest({
      tenantId,
      actorUserId: creatorId,
      originSectorId,
      destinationSectorId,
      title: "Solicitação para desligamento",
      dueAt: originalDueAt,
    });

    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;
    const requestId = created.request.id as string;

    const assigned = await assignRequest({
      tenantId,
      requestId,
      actorUserId: destinationManagerId,
      assigneeUserId: assigneeAId,
    });
    expect(assigned.kind).toBe("assigned");

    const deactivated = await deactivateSectorMember({
      tenantId,
      actorUserId: destinationManagerId,
      sectorId: destinationSectorId,
      userId: assigneeAId,
    });
    expect(deactivated.kind).toBe("deactivated");
    if (deactivated.kind === "deactivated") {
      expect(deactivated.waitingReassignmentCount).toBeGreaterThanOrEqual(1);
    }

    const request = await admin.query<{
      assigned_to: string | null;
      status: string;
      due_at: Date;
    }>(
      `SELECT assigned_to, status, due_at FROM requests WHERE id = $1`,
      [requestId],
    );

    expect(request.rows[0]!.assigned_to).toBeNull();
    expect(request.rows[0]!.status).toBe("WAITING_REASSIGNMENT");
    expect(request.rows[0]!.due_at.toISOString()).toBe(originalDueAt.toISOString());

    const membership = await admin.query<{ active: boolean }>(
      `SELECT active
         FROM memberships
        WHERE tenant_id = $1
          AND sector_id = $2
          AND user_id = $3`,
      [tenantId, destinationSectorId, assigneeAId],
    );
    expect(membership.rows[0]!.active).toBe(false);
  });

  it("audits due date changes and cancellation without deleting history", async () => {
    const dueAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    const created = await createRequest({
      tenantId,
      actorUserId: creatorId,
      originSectorId,
      destinationSectorId,
      title: "Solicitação cancelável",
      dueAt,
    });

    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;
    const requestId = created.request.id as string;

    const newDueAt = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
    const changed = await changeRequestDueDate({
      tenantId,
      requestId,
      actorUserId: originApproverId,
      dueAt: newDueAt,
      reason: "Ajuste acordado com o setor de destino.",
    });
    expect(changed.kind).toBe("updated");

    const cancelled = await cancelRequest({
      tenantId,
      requestId,
      actorUserId: originApproverId,
      reason: "Demanda não é mais necessária.",
    });
    expect(cancelled.kind).toBe("cancelled");

    const row = await admin.query<{ status: string; due_at: Date }>(
      `SELECT status, due_at FROM requests WHERE id = $1`,
      [requestId],
    );
    expect(row.rows[0]!.status).toBe("CANCELLED");
    expect(row.rows[0]!.due_at.toISOString()).toBe(newDueAt.toISOString());

    const audit = await admin.query<{ action: string }>(
      `SELECT action
         FROM audit_events
        WHERE tenant_id = $1
          AND entity_type = 'request'
          AND entity_id = $2
        ORDER BY chain_seq`,
      [tenantId, requestId],
    );

    expect(audit.rows.map((event) => event.action)).toContain("REQUEST_DUE_DATE_CHANGED");
    expect(audit.rows.map((event) => event.action)).toContain("REQUEST_CANCELLED");
  });
});
