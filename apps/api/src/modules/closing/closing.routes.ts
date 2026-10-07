import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { closeRequest, createRetification } from "./closing.service.js";

export async function closingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/requests/:id/close", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await closeRequest({
      tenantId: request.user.tenantId,
      requestId: params.id,
      actorUserId: request.user.sub,
    });

    switch (result.kind) {
      case "not_found": return reply.code(404).send({ message: "Solicitação não encontrada." });
      case "forbidden": return reply.code(403).send({ message: "Sem permissão para fechar." });
      case "invalid_state": return reply.code(409).send({ message: "Somente solicitação aprovada pode ser fechada.", status: result.status });
      case "closed": return reply.code(200).send({ closed: true, snapshot: result.snapshot });
    }
  });

  app.post("/v1/requests/:id/retifications", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      dueAt: z.coerce.date(),
      reason: z.string().trim().min(3).max(2000),
    }).parse(request.body);

    const result = await createRetification({
      tenantId: request.user.tenantId,
      originalRequestId: params.id,
      actorUserId: request.user.sub,
      dueAt: body.dueAt,
      reason: body.reason,
    });

    switch (result.kind) {
      case "not_found": return reply.code(404).send({ message: "Solicitação original não encontrada." });
      case "forbidden": return reply.code(403).send({ message: "Sem permissão para retificar." });
      case "invalid_state": return reply.code(409).send({ message: "Somente solicitação fechada pode ser retificada.", status: result.status });
      case "already_active": return reply.code(409).send({ message: "Já existe retificação ativa para esta solicitação." });
      case "created": return reply.code(201).send(result.request);
    }
  });
}
