import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createDataSubjectRequest,
  createProcessingActivity,
  exportDataSubject,
  getComplianceSettings,
  listDataSubjectRequests,
  listProcessingActivities,
  listRetentionCandidates,
  updateComplianceSettings,
  updateDataSubjectRequest,
  updateProcessingActivity,
} from "./compliance.service.js";

export async function complianceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/compliance", { preHandler: app.authenticate }, async (request, reply) => {
    const result = await getComplianceSettings({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
    });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem permissão." });
    return reply.send(result.settings);
  });

  app.patch("/v1/admin/compliance", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({
      retentionYears: z.coerce.number().int().min(1).max(20),
      defaultLegalBasis: z.string().trim().max(500).optional(),
      dpaStatus: z.enum(["NOT_CONFIGURED", "DRAFT", "SIGNED"]).optional(),
      dpaReference: z.string().trim().max(500).optional(),
      dpaSignedAt: z.coerce.date().optional(),
    }).parse(request.body);

    const result = await updateComplianceSettings({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      retentionYears: body.retentionYears,
      ...(body.defaultLegalBasis ? { defaultLegalBasis: body.defaultLegalBasis } : {}),
      ...(body.dpaStatus ? { dpaStatus: body.dpaStatus } : {}),
      ...(body.dpaReference ? { dpaReference: body.dpaReference } : {}),
      ...(body.dpaSignedAt ? { dpaSignedAt: body.dpaSignedAt } : {}),
    });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem permissão." });
    if (result.kind === "invalid_dpa") {
      return reply.code(422).send({ message: "DPA assinado exige data de assinatura." });
    }
    return reply.send(result.settings);
  });

  app.get("/v1/admin/compliance/retention-candidates", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }).parse(request.query);

    const result = await listRetentionCandidates({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      limit: query.limit,
    });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem permissão." });
    return reply.send({
      retentionYears: result.retentionYears,
      data: result.data,
    });
  });

  app.post("/v1/admin/data-subject-requests", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({
      subjectUserId: z.string().uuid(),
      requestType: z.enum(["ACCESS", "CORRECTION", "ERASURE", "RESTRICTION"]),
      reason: z.string().trim().max(2000).optional(),
    }).parse(request.body);

    const result = await createDataSubjectRequest({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      subjectUserId: body.subjectUserId,
      requestType: body.requestType,
      ...(body.reason ? { reason: body.reason } : {}),
    });

    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem permissão." });
    if (result.kind === "subject_not_found") return reply.code(404).send({ message: "Titular não pertence ao tenant." });
    return reply.code(201).send(result.request);
  });

  app.get("/v1/admin/data-subject-requests", { preHandler: app.authenticate }, async (request, reply) => {
    const result = await listDataSubjectRequests({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
    });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem permissão." });
    return reply.send({ data: result.data });
  });

  app.patch("/v1/admin/data-subject-requests/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      status: z.enum(["OPEN", "IN_REVIEW", "COMPLETED", "REJECTED"]),
      resolution: z.string().trim().max(4000).optional(),
    }).parse(request.body);

    const result = await updateDataSubjectRequest({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      requestId: params.id,
      status: body.status,
      ...(body.resolution ? { resolution: body.resolution } : {}),
    });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem permissão." });
    if (result.kind === "not_found") return reply.code(404).send({ message: "Pedido não encontrado." });
    if (result.kind === "terminal_state") {
      return reply.code(409).send({ message: "Pedido encerrado não pode ser reaberto.", status: result.status });
    }
    if (result.kind === "resolution_required") {
      return reply.code(422).send({ message: "Conclusão ou rejeição exige resolução." });
    }
    return reply.send(result.request);
  });

  app.get("/v1/admin/data-subjects/:userId/export", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const result = await exportDataSubject({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      subjectUserId: params.userId,
    });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem permissão." });
    if (result.kind === "not_found") return reply.code(404).send({ message: "Titular não encontrado." });

    return reply
      .header("content-disposition", `attachment; filename="data-subject-${params.userId}.json"`)
      .send(result.data);
  });

  app.get("/v1/admin/compliance/processing-activities", { preHandler: app.authenticate }, async (request, reply) => {
    const result = await listProcessingActivities({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
    });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem permissão." });
    return reply.send({ data: result.data });
  });

  app.post("/v1/admin/compliance/processing-activities", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({
      name: z.string().trim().min(2).max(200),
      purpose: z.string().trim().min(3).max(2000),
      legalBasis: z.string().trim().min(3).max(1000),
      dataCategories: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
      subjectCategories: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
      processors: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
      retentionYears: z.coerce.number().int().min(1).max(20).optional(),
    }).parse(request.body);

    const result = await createProcessingActivity({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      name: body.name,
      purpose: body.purpose,
      legalBasis: body.legalBasis,
      dataCategories: body.dataCategories,
      subjectCategories: body.subjectCategories,
      processors: body.processors,
      ...(body.retentionYears ? { retentionYears: body.retentionYears } : {}),
    });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem permissão." });
    return reply.code(201).send(result.activity);
  });

  app.put("/v1/admin/compliance/processing-activities/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      name: z.string().trim().min(2).max(200),
      purpose: z.string().trim().min(3).max(2000),
      legalBasis: z.string().trim().min(3).max(1000),
      dataCategories: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
      subjectCategories: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
      processors: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
      retentionYears: z.coerce.number().int().min(1).max(20).optional(),
      active: z.boolean().default(true),
    }).parse(request.body);

    const result = await updateProcessingActivity({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      activityId: params.id,
      name: body.name,
      purpose: body.purpose,
      legalBasis: body.legalBasis,
      dataCategories: body.dataCategories,
      subjectCategories: body.subjectCategories,
      processors: body.processors,
      active: body.active,
      ...(body.retentionYears ? { retentionYears: body.retentionYears } : {}),
    });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem permissão." });
    if (result.kind === "not_found") return reply.code(404).send({ message: "Operação de tratamento não encontrada." });
    return reply.send(result.activity);
  });

}
