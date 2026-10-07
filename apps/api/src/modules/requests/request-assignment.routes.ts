import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { assignRequest } from "./request-assignment.service.js";

export async function requestAssignmentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/requests/:id/assign", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ assigneeUserId: z.string().uuid() }).parse(request.body);

    const result = await assignRequest({
      tenantId: request.user.tenantId,
      requestId: params.id,
      actorUserId: request.user.sub,
      assigneeUserId: body.assigneeUserId,
    });

    switch (result.kind) {
      case "not_found":
        return reply.code(404).send({ message: "Solicitação não encontrada." });
      case "invalid_state":
        return reply.code(409).send({
          message: "Solicitação não pode ser atribuída no estado atual.",
          status: result.status,
        });
      case "forbidden":
        return reply.code(403).send({
          message: "Somente Gestor ativo do setor de destino pode atribuir.",
        });
      case "invalid_assignee":
        return reply.code(422).send({
          message: "Responsável precisa ser membro ativo do setor de destino.",
        });
      case "assigned":
        return reply.code(200).send({
          changed: true,
          assigneeUserId: result.assigneeUserId,
        });
    }
  });
}
