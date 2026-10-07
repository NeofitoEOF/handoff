import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getInbox, getSectorMetrics } from "./dashboard.service.js";

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/inbox", { preHandler: app.authenticate }, async (request) => {
    const query = z.object({
      view: z.enum(["assigned", "sector", "to_review", "overdue"]).default("assigned"),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(request.query);

    return {
      data: await getInbox({
        tenantId: request.user.tenantId,
        userId: request.user.sub,
        view: query.view,
        limit: query.limit,
        offset: query.offset,
      }),
      pagination: {
        limit: query.limit,
        offset: query.offset,
      },
    };
  });

  app.get("/v1/sectors/:id/metrics", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await getSectorMetrics({
      tenantId: request.user.tenantId,
      userId: request.user.sub,
      sectorId: params.id,
    });

    if (result.kind === "forbidden") {
      return reply.code(403).send({ message: "Sem acesso ao setor." });
    }
    return reply.send(result.metrics);
  });
}
