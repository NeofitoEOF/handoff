import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createCampaign, createRecurrence, getCampaign } from "./campaign.service.js";

export async function campaignRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/campaigns", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({
      originSectorId: z.string().uuid(),
      destinationSectorIds: z.array(z.string().uuid()).min(1).max(100),
      templateVersionId: z.string().uuid().optional(),
      title: z.string().trim().min(3).max(160),
      competence: z.string().trim().min(1).max(80).optional(),
      dueAt: z.coerce.date(),
      instructions: z.string().trim().max(5000).optional(),
    }).parse(request.body);

    const result = await createCampaign({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      originSectorId: body.originSectorId,
      destinationSectorIds: body.destinationSectorIds,
      title: body.title,
      dueAt: body.dueAt,
      ...(body.templateVersionId ? { templateVersionId: body.templateVersionId } : {}),
      ...(body.competence ? { competence: body.competence } : {}),
      ...(body.instructions ? { instructions: body.instructions } : {}),
    });

    switch (result.kind) {
      case "forbidden": return reply.code(403).send({ message: "Sem acesso ao setor de origem." });
      case "no_destinations": return reply.code(422).send({ message: "Informe pelo menos um setor de destino diferente da origem." });
      case "invalid_destination": return reply.code(422).send({ message: "Existe setor de destino inválido ou inativo." });
      case "invalid_template": return reply.code(422).send({ message: "Versão de modelo inválida." });
      case "created": return reply.code(201).send(result);
    }
  });

  app.get("/v1/campaigns/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await getCampaign({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      campaignId: params.id,
    });
    if (result.kind === "not_found") return reply.code(404).send({ message: "Coleta não encontrada." });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem acesso à coleta." });
    return reply.send(result);
  });

  app.post("/v1/recurrences", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({
      originSectorId: z.string().uuid(),
      destinationSectorIds: z.array(z.string().uuid()).min(1).max(100),
      templateVersionId: z.string().uuid().optional(),
      title: z.string().trim().min(3).max(160),
      instructions: z.string().trim().max(5000).optional(),
      frequency: z.enum(["WEEKLY", "MONTHLY"]),
      nextRunAt: z.coerce.date(),
      dueOffsetDays: z.number().int().min(0).max(90).default(5),
    }).parse(request.body);

    const result = await createRecurrence({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      originSectorId: body.originSectorId,
      destinationSectorIds: body.destinationSectorIds,
      title: body.title,
      frequency: body.frequency,
      nextRunAt: body.nextRunAt,
      dueOffsetDays: body.dueOffsetDays,
      ...(body.templateVersionId ? { templateVersionId: body.templateVersionId } : {}),
      ...(body.instructions ? { instructions: body.instructions } : {}),
    });

    if (result.kind === "forbidden") return reply.code(403).send({ message: "Somente Gestor do setor pode criar recorrência." });
    if (result.kind === "no_destinations") return reply.code(422).send({ message: "Informe setores de destino." });
    return reply.code(201).send(result.recurrence);
  });
}
