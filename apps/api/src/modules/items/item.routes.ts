import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listRequestItems, submitRequestItems, upsertRequestItem } from "./item.service.js";

const requestParams = z.object({ id: z.string().uuid() });

export async function itemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/requests/:id/items", { preHandler: app.authenticate }, async (request, reply) => {
    const params = requestParams.parse(request.params);
    const result = await listRequestItems({
      tenantId: request.user.tenantId,
      requestId: params.id,
      actorUserId: request.user.sub,
    });

    if (result.kind === "not_found") return reply.code(404).send({ message: "Solicitação não encontrada." });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem acesso à solicitação." });
    return reply.send({ data: result.items });
  });

  app.put("/v1/requests/:id/items/:itemKey", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({
      id: z.string().uuid(),
      itemKey: z.string().trim().min(1).max(120),
    }).parse(request.params);
    const body = z.object({ data: z.record(z.string(), z.unknown()) }).parse(request.body);

    const result = await upsertRequestItem({
      tenantId: request.user.tenantId,
      requestId: params.id,
      actorUserId: request.user.sub,
      itemKey: params.itemKey,
      data: body.data,
    });

    switch (result.kind) {
      case "not_found": return reply.code(404).send({ message: "Solicitação não encontrada." });
      case "forbidden": return reply.code(403).send({ message: "Sem acesso ao setor de destino." });
      case "not_assignee": return reply.code(403).send({ message: "Solicitação atribuída a outro responsável." });
      case "invalid_state": return reply.code(409).send({ message: "Solicitação não aceita edição neste estado.", status: result.status });
      case "item_locked": return reply.code(409).send({ message: "Item submetido/aprovado está bloqueado." });
      case "field_locked": return reply.code(422).send({ message: "Há campos ocultos ou somente leitura para o seu papel.", fields: result.fields });
      case "saved": return reply.code(200).send(result.item);
    }
  });

  app.post("/v1/requests/:id/submit", { preHandler: app.authenticate }, async (request, reply) => {
    const params = requestParams.parse(request.params);
    const result = await submitRequestItems({
      tenantId: request.user.tenantId,
      requestId: params.id,
      actorUserId: request.user.sub,
    });

    switch (result.kind) {
      case "not_found": return reply.code(404).send({ message: "Solicitação não encontrada." });
      case "forbidden":
      case "not_assignee": return reply.code(403).send({ message: "Sem permissão para submeter." });
      case "invalid_state": return reply.code(409).send({ message: "Estado não permite submissão.", status: result.status });
      case "nothing_to_submit": return reply.code(422).send({ message: "Não há itens pendentes para submeter." });
      case "submitted": return reply.code(200).send({ submitted: true });
    }
  });
}
