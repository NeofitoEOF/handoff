import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listDeadLetters, retryDeadLetter } from "./dead-letter.service.js";

const kindSchema = z.enum(["email", "teams", "webhook", "closure"]);

export async function deadLetterRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/admin/dead-letters",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const query = z.object({
        kind: kindSchema.optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      }).parse(request.query);

      const result = await listDeadLetters({
        tenantId: request.user.tenantId,
        actorUserId: request.user.sub,
        ...(query.kind ? { kind: query.kind } : {}),
        limit: query.limit,
      });

      if (result.kind === "forbidden") {
        return reply.code(403).send({ message: "Somente Admin da Empresa pode consultar falhas operacionais." });
      }

      return reply.send({ data: result.items });
    },
  );

  app.post(
    "/v1/admin/dead-letters/:kind/:id/retry",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z.object({
        kind: kindSchema,
        id: z.string().uuid(),
      }).parse(request.params);

      const body = z.object({
        reason: z.string().trim().min(3).max(1000),
      }).parse(request.body);

      const result = await retryDeadLetter({
        tenantId: request.user.tenantId,
        actorUserId: request.user.sub,
        kind: params.kind,
        id: params.id,
        reason: body.reason,
      });

      if (result.kind === "forbidden") {
        return reply.code(403).send({ message: "Somente Admin da Empresa pode reprocessar falhas." });
      }

      if (result.kind === "not_found") {
        return reply.code(404).send({
          message: "Item esgotado não encontrado ou ainda possui tentativas automáticas disponíveis.",
        });
      }

      return reply.send({ requeued: true });
    },
  );
}
