import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  exportTenantAudit,
  getRequestTimeline,
  verifyTenantAuditChain,
} from "./audit.service.js";

function csvEscape(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/requests/:id/timeline", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await getRequestTimeline({
      tenantId: request.user.tenantId,
      requestId: params.id,
      userId: request.user.sub,
    });

    if (result.kind !== "ok") {
      return reply.code(404).send({ message: "Solicitação não encontrada ou sem acesso." });
    }

    return reply.send({ data: result.events });
  });

  app.get("/v1/audit/export.csv", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z.object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }).parse(request.query);

    const result = await exportTenantAudit({
      tenantId: request.user.tenantId,
      userId: request.user.sub,
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
    });

    if (result.kind === "forbidden") {
      return reply.code(403).send({ message: "Somente Admin/Auditor pode exportar auditoria." });
    }

    const header = "id,actor_user_id,action,entity_type,entity_id,before_data,after_data,created_at";
    const rows = result.events.map((event: Record<string, unknown>) =>
      [
        event.id,
        event.actor_user_id,
        event.action,
        event.entity_type,
        event.entity_id,
        event.before_data,
        event.after_data,
        event.created_at,
      ].map(csvEscape).join(","),
    );

    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="audit.csv"')
      .send([header, ...rows].join("\n"));
  });

  app.get("/v1/audit/verify", { preHandler: app.authenticate }, async (request, reply) => {
    const result = await verifyTenantAuditChain({
      tenantId: request.user.tenantId,
      userId: request.user.sub,
    });

    if (result.kind === "forbidden") {
      return reply.code(403).send({
        message: "Somente Admin/Auditor pode verificar a auditoria.",
      });
    }

    if (result.kind === "invalid") {
      return reply.code(409).send({
        valid: false,
        ...result,
      });
    }

    return reply.send({
      valid: true,
      eventCount: result.eventCount,
      lastHash: result.lastHash,
    });
  });
}
