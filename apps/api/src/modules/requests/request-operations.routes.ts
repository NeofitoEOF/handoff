import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cancelRequest, changeRequestDueDate } from "./request-operations.service.js";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function requestOperationRoutes(app: FastifyInstance): Promise<void> {
  app.patch("/v1/requests/:id/due-date", { preHandler: app.authenticate }, async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const body = z.object({
      dueAt: z.coerce.date(),
      reason: z.string().trim().min(3).max(1000),
    }).parse(request.body);

    const result = await changeRequestDueDate({
      tenantId: request.user.tenantId,
      requestId: params.id,
      actorUserId: request.user.sub,
      newDueAt: body.dueAt,
      reason: body.reason,
    });

    switch (result.kind) {
      case "not_found": return reply.code(404).send({ message: "Solicitação não encontrada." });
      case "forbidden": return reply.code(403).send({ message: "Sem permissão para alterar o prazo." });
      case "invalid_state": return reply.code(409).send({ message: "Estado não permite alterar prazo.", status: result.status });
      case "invalid_due_date": return reply.code(422).send({ message: "O novo prazo deve estar no futuro." });
      case "changed": return reply.code(200).send({ changed: true });
    }
  });

  app.post("/v1/requests/:id/cancel", { preHandler: app.authenticate }, async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const body = z.object({ reason: z.string().trim().min(3).max(1000) }).parse(request.body);

    const result = await cancelRequest({
      tenantId: request.user.tenantId,
      requestId: params.id,
      actorUserId: request.user.sub,
      reason: body.reason,
    });

    switch (result.kind) {
      case "not_found": return reply.code(404).send({ message: "Solicitação não encontrada." });
      case "forbidden": return reply.code(403).send({ message: "Sem permissão para cancelar." });
      case "invalid_state": return reply.code(409).send({ message: "Estado não permite cancelamento.", status: result.status });
      case "cancelled": return reply.code(200).send({ cancelled: true });
    }
  });
}
