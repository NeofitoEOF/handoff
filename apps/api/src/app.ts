import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
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
import { templateRoutes } from "./modules/templates/template.routes.js";
import { closingRoutes } from "./modules/closing/closing.routes.js";
import { importRoutes } from "./modules/imports/import.routes.js";
import { evidenceRoutes } from "./modules/evidence/evidence.routes.js";
import { identityRoutes } from "./modules/identity/identity.routes.js";
import { invitationRoutes } from "./modules/identity/invitation.routes.js";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes.js";
import { auditRoutes } from "./modules/audit/audit.routes.js";
import { campaignRoutes } from "./modules/campaigns/campaign.routes.js";
import { tenantRoutes } from "./modules/tenancy/tenant.routes.js";
import { guestRoutes } from "./modules/guest/guest.routes.js";
import { notificationRoutes } from "./modules/notifications/notification.routes.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cookie);
  await registerAuth(app);
  await app.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024,
      files: 1,
    },
  });

  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok" };
  });

  await app.register(identityRoutes);
  await app.register(invitationRoutes);
  await app.register(dashboardRoutes);
  await app.register(auditRoutes);
  await app.register(campaignRoutes);
  await app.register(tenantRoutes);
  await app.register(guestRoutes);
  await app.register(notificationRoutes);
  await app.register(sectorRoutes);
  await app.register(requestCreateRoutes);
  await app.register(requestAssignmentRoutes);
  await app.register(requestOperationRoutes);
  await app.register(itemRoutes);
  await app.register(reviewRoutes);
  await app.register(templateRoutes);
  await app.register(closingRoutes);
  await app.register(importRoutes);
  await app.register(evidenceRoutes);
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
