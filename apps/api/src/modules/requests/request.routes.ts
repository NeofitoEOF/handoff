import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { reassignRequest } from "./request.service.js";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const bodySchema = z.object({
  newAssigneeUserId: z.string().uuid(),
  reason: z.enum([
    "ABSENCE",
    "TERMINATION",
    "ROLE_CHANGE",
    "WORKLOAD",
    "WRONG_ASSIGNMENT",
    "ESCALATION",
    "OTHER",
  ]),
  comment: z.string().trim().max(1000).optional(),
});

export async function requestRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/requests/:id/reassign",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = paramsSchema.parse(request.params);
      const body = bodySchema.parse(request.body);

      const result = await reassignRequest({
        tenantId: request.user.tenantId,
        requestId: params.id,
        actorUserId: request.user.sub,
        newAssigneeUserId: body.newAssigneeUserId,
        reason: body.reason,
        ...(body.comment ? { comment: body.comment } : {}),
      });

      switch (result.kind) {
        case "not_found":
          return reply.code(404).send({ message: "Solicitação não encontrada." });
        case "invalid_state":
          return reply.code(409).send({
            message: "Solicitação não pode ser reatribuída no estado atual.",
            status: result.status,
          });
        case "invalid_assignee":
          return reply.code(422).send({
            message: "Novo responsável não pertence ao setor de destino.",
          });
        case "no_change":
          return reply.code(200).send({ changed: false });
        case "reassigned":
          return reply.code(200).send({
            changed: true,
            previousAssigneeUserId: result.previousAssigneeUserId,
            newAssigneeUserId: result.newAssigneeUserId,
          });
      }
    },
  );
}
