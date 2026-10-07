import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listNotifications, markNotificationRead } from "./notification.service.js";

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/notifications", { preHandler: app.authenticate }, async (request) => {
    const query = z.object({
      unreadOnly: z.coerce.boolean().default(false),
    }).parse(request.query);

    return {
      data: await listNotifications({
        tenantId: request.user.tenantId,
        userId: request.user.sub,
        unreadOnly: query.unreadOnly,
      }),
    };
  });

  app.post("/v1/notifications/:id/read", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await markNotificationRead({
      tenantId: request.user.tenantId,
      userId: request.user.sub,
      notificationId: params.id,
    });
    if (!result) return reply.code(404).send({ message: "Notificação não encontrada." });
    return reply.send(result);
  });
}
