import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { exportTenantData, provisionTenant, suspendTenant } from "./tenant.service.js";

function platformAuthorized(request: FastifyRequest): boolean {
  const supplied = request.headers["x-platform-admin-key"];
  if (typeof supplied !== "string") return false;

  const expected = Buffer.from(config.PLATFORM_ADMIN_KEY);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function tenantRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/platform/tenants", async (request, reply) => {
    if (!platformAuthorized(request)) {
      return reply.code(401).send({ message: "Credencial de provisionamento inválida." });
    }

    const body = z.object({
      name: z.string().trim().min(2).max(200),
      document: z.string().trim().max(40).optional(),
      subdomain: z.string().trim().regex(/^[a-z0-9-]{3,63}$/),
      adminEmail: z.string().email(),
      adminName: z.string().trim().min(2).max(160),
      adminPassword: z.string().min(12).max(200),
    }).parse(request.body);

    const result = await provisionTenant(body);
    return reply.code(201).send(result);
  });

  app.post("/v1/platform/tenants/:id/suspend", async (request, reply) => {
    if (!platformAuthorized(request)) {
      return reply.code(401).send({ message: "Credencial de provisionamento inválida." });
    }
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return reply.send(await suspendTenant(params.id));
  });

  app.get("/v1/admin/tenant/export", { preHandler: app.authenticate }, async (request, reply) => {
    const result = await exportTenantData({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
    });

    if (result.kind === "forbidden") {
      return reply.code(403).send({ message: "Somente Admin da Empresa pode exportar o tenant." });
    }

    return reply
      .header("content-disposition", 'attachment; filename="handoff-tenant-export.json"')
      .send(result);
  });
}
