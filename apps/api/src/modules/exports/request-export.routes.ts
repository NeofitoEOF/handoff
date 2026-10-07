import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exportRequestCsv, exportRequestXlsx } from "./request-export.service.js";

export async function requestExportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/requests/:id/export.xlsx", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await exportRequestXlsx({
      tenantId: request.user.tenantId,
      requestId: params.id,
      actorUserId: request.user.sub,
    });
    if (result.kind === "not_found") {
      return reply.code(404).send({ message: "Solicitação não encontrada ou sem acesso." });
    }
    return reply
      .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("content-disposition", `attachment; filename="${result.filename}"`)
      .send(result.buffer);
  });

  app.get("/v1/requests/:id/export.csv", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await exportRequestCsv({
      tenantId: request.user.tenantId,
      requestId: params.id,
      actorUserId: request.user.sub,
    });
    if (result.kind === "not_found") {
      return reply.code(404).send({ message: "Solicitação não encontrada ou sem acesso." });
    }
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${result.filename}"`)
      .send(result.content);
  });
}
