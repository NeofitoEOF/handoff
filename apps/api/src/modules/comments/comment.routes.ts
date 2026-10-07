import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { addComment, listComments } from "./comment.service.js";

export async function commentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/requests/:id/comments", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await listComments({
      tenantId: request.user.tenantId,
      requestId: params.id,
      actorUserId: request.user.sub,
    });
    if (result.kind === "not_found") {
      return reply.code(404).send({ message: "Solicitação não encontrada ou sem acesso." });
    }
    return reply.send({ data: result.comments });
  });

  app.post("/v1/requests/:id/comments", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      itemId: z.string().uuid().optional(),
      fieldKey: z.string().trim().min(1).max(120).optional(),
      text: z.string().trim().min(1).max(4000),
    }).parse(request.body);

    const result = await addComment({
      tenantId: request.user.tenantId,
      requestId: params.id,
      actorUserId: request.user.sub,
      text: body.text,
      ...(body.itemId ? { itemId: body.itemId } : {}),
      ...(body.fieldKey ? { fieldKey: body.fieldKey } : {}),
    });

    if (result.kind === "not_found") return reply.code(404).send({ message: "Solicitação não encontrada." });
    if (result.kind === "item_not_found") return reply.code(404).send({ message: "Item não pertence à solicitação." });
    return reply.code(201).send(result.comment);
  });
}
