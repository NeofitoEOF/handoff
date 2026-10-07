import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { registerAuth } from "./auth.js";
import { pool } from "./db.js";
import { config } from "./config.js";
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
import { complianceRoutes } from "./modules/tenancy/compliance.routes.js";
import { guestRoutes } from "./modules/guest/guest.routes.js";
import { guestFileRoutes } from "./modules/guest/guest-files.routes.js";
import { notificationRoutes } from "./modules/notifications/notification.routes.js";
import { requestExportRoutes } from "./modules/exports/request-export.routes.js";
import { commentRoutes } from "./modules/comments/comment.routes.js";
import { microsoftRoutes } from "./modules/integrations/microsoft.routes.js";
import { importMappingRoutes } from "./modules/imports/import-mapping.routes.js";
import { billingRoutes } from "./modules/billing/billing.routes.js";
import { publicApiRoutes } from "./modules/integrations/public-api.routes.js";
import { registerMetrics } from "./metrics.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers.set-cookie",
      ],
    },
  });

  await app.register(cors, {
    origin: config.WEB_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
    credentials: true,
  });
  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: "1 minute",
  });
  await app.register(cookie);
  await registerMetrics(app);
  await registerAuth(app);
  await app.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024,
      files: 1,
    },
  });

  app.get("/live", async () => {
    return { status: "ok" };
  });

  app.get("/ready", async () => {
    await pool.query("SELECT 1");
    return { status: "ok" };
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
  await app.register(complianceRoutes);
  await app.register(guestRoutes);
  await app.register(guestFileRoutes);
  await app.register(notificationRoutes);
  await app.register(requestExportRoutes);
  await app.register(commentRoutes);
  await app.register(microsoftRoutes);
  await app.register(importMappingRoutes);
  await app.register(billingRoutes);
  await app.register(publicApiRoutes);
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

    if (typeof error === "object" && error !== null && "statusCode" in error) {
      const statusCode = (error as { statusCode?: unknown }).statusCode;
      if (typeof statusCode === "number") {
        const message =
          "message" in error && typeof (error as { message?: unknown }).message === "string"
            ? (error as { message: string }).message
            : "Erro na requisição.";
        return reply.code(statusCode).send({ message });
      }
    }

    app.log.error(error);
    return reply.code(500).send({ message: "Erro interno." });
  });

  return app;
}
