import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { approveItem, returnItem } from "./review.service.js";

const paramsSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
});

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/requests/:id/items/:itemId/approve",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = paramsSchema.parse(request.params);
      const result = await approveItem({
        tenantId: request.user.tenantId,
        requestId: params.id,
        itemId: params.itemId,
        actorUserId: request.user.sub,
      });

      switch (result.kind) {
        case "forbidden": return reply.code(403).send({ message: "Somente Aprovador/Gestor do setor de origem pode revisar." });
        case "not_found": return reply.code(404).send({ message: "Item não encontrado." });
        case "invalid_state": return reply.code(409).send({ message: "Item não está submetido.", status: result.status });
        case "maker_checker": return reply.code(409).send({ message: "Quem submeteu o item não pode aprová-lo." });
        case "already_approved": return reply.code(409).send({ message: "Você já aprovou este item. Outra pessoa precisa concluir a alçada." });
        case "pending_second": return reply.code(200).send({
          approved: false,
          pendingSecond: true,
          approvals: result.approvals,
          required: result.required,
          requestStatus: result.requestStatus,
        });
        case "approved": return reply.code(200).send({ approved: true, requestStatus: result.requestStatus });
      }
    },
  );

  app.post(
    "/v1/requests/:id/items/:itemId/return",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = paramsSchema.parse(request.params);
      const body = z.object({
        comment: z.string().trim().min(3).max(2000),
        correctionDueAt: z.coerce.date(),
      }).parse(request.body);

      const result = await returnItem({
        tenantId: request.user.tenantId,
        requestId: params.id,
        itemId: params.itemId,
        actorUserId: request.user.sub,
        comment: body.comment,
        correctionDueAt: body.correctionDueAt,
      });

      switch (result.kind) {
        case "forbidden": return reply.code(403).send({ message: "Somente Aprovador/Gestor do setor de origem pode revisar." });
        case "not_found": return reply.code(404).send({ message: "Item não encontrado." });
        case "invalid_state": return reply.code(409).send({ message: "Item não está submetido.", status: result.status });
        case "maker_checker": return reply.code(409).send({ message: "Quem submeteu o item não pode devolvê-lo como revisor." });
        case "invalid_due_date": return reply.code(422).send({ message: "Prazo de correção deve estar no futuro." });
        case "returned": return reply.code(200).send({ returned: true, requestStatus: result.requestStatus });
      }
    },
  );
}
