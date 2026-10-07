import Fastify from "fastify";
import { ZodError } from "zod";
import { registerAuth } from "./auth.js";
import { pool } from "./db.js";
import { requestRoutes } from "./modules/requests/request.routes.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await registerAuth(app);

  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok" };
  });

  await app.register(requestRoutes);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        message: "Payload inválido.",
        issues: error.issues,
      });
    }

    app.log.error(error);
    return reply.code(500).send({ message: "Erro interno." });
  });

  return app;
}
