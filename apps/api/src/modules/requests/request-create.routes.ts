import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createRequest } from "./request-create.service.js";

const bodySchema = z.object({
  originSectorId: z.string().uuid(),
  destinationSectorId: z.string().uuid(),
  title: z.string().trim().min(3).max(160),
  dueAt: z.coerce.date(),
  competence: z.string().trim().min(1).max(80).optional(),
  instructions: z.string().trim().max(5000).optional(),
});

export async function requestCreateRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/requests", { preHandler: app.authenticate }, async (request, reply) => {
    const body = bodySchema.parse(request.body);

    const result = await createRequest({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      originSectorId: body.originSectorId,
      destinationSectorId: body.destinationSectorId,
      title: body.title,
      dueAt: body.dueAt,
      ...(body.competence ? { competence: body.competence } : {}),
      ...(body.instructions ? { instructions: body.instructions } : {}),
    });

    switch (result.kind) {
      case "same_sector":
        return reply.code(422).send({ message: "Setor de origem e destino devem ser diferentes." });
      case "forbidden":
        return reply.code(403).send({ message: "Usuário não pertence ao setor de origem." });
      case "invalid_sector":
        return reply.code(422).send({ message: "Setor de origem ou destino é inválido/inativo." });
      case "duplicate_competence":
        return reply.code(409).send({
          message: "Já existe solicitação ativa para este fluxo e competência.",
        });
      case "created":
        return reply.code(201).send(result.request);
    }
  });
}
