import Fastify from "fastify";
import { ZodError } from "zod";
import { registerAuth } from "./auth.js";
import { pool } from "./db.js";
import { requestRoutes } from "./modules/requests/request.routes.js";
import { requestCreateRoutes } from "./modules/requests/request-create.routes.js";
import { requestAssignmentRoutes } from "./modules/requests/request-assignment.routes.js";
import { sectorRoutes } from "./modules/sectors/sector.routes.js";
import { requestOperationRoutes } from "./modules/requests/request-operations.routes.js";
import { itemRoutes } from "./modules/items/item.routes.js";
import { reviewRoutes } from "./modules/reviews/review.routes.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await registerAuth(app);

  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok" };
  });

  await app.register(sectorRoutes);
  await app.register(requestCreateRoutes);
  await app.register(requestAssignmentRoutes);
  await app.register(requestOperationRoutes);
  await app.register(itemRoutes);
  await app.register(reviewRoutes);
  await app.register(requestRoutes);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        message: "Payload inválido.",
        issues: error.issues,
      });
    }

    if ("statusCode" in error && typeof error.statusCode === "number") {
      return reply.code(error.statusCode).send({ message: error.message });
    }

    app.log.error(error);
    return reply.code(500).send({ message: "Erro interno." });
  });

  return app;
}
