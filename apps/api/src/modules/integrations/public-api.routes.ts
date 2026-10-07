import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  authenticatePublicApiRequest,
  createApiKey,
  createWebhook,
  disableWebhook,
  listApiKeys,
  listWebhooks,
  revokeApiKey,
} from "./public-api.service.js";
import { withTenantTransaction } from "../../db.js";

const uuidParams = z.object({ id: z.string().uuid() });

export async function publicApiRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/admin/api-keys", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({
      name: z.string().trim().min(2).max(120),
      scopes: z.array(z.literal("requests:read")).min(1).default(["requests:read"]),
      expiresAt: z.coerce.date().optional(),
    }).parse(request.body);

    const result = await createApiKey({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      name: body.name,
      scopes: body.scopes,
      ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
    });

    if (result.kind === "forbidden") {
      return reply.code(403).send({ message: "Somente Admin da Empresa pode criar API keys." });
    }
    return reply.code(201).send(result);
  });

  app.get("/v1/admin/api-keys", { preHandler: app.authenticate }, async (request, reply) => {
    const result = await listApiKeys({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
    });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem permissão." });
    return reply.send({ data: result.data });
  });

  app.delete("/v1/admin/api-keys/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const params = uuidParams.parse(request.params);
    const result = await revokeApiKey({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      apiKeyId: params.id,
    });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem permissão." });
    if (result.kind === "not_found") return reply.code(404).send({ message: "API key não encontrada." });
    return reply.send({ revoked: true });
  });

  app.post("/v1/admin/webhooks", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({
      url: z.string().url(),
      events: z.array(z.enum(["request.approved", "request.overdue"])).min(1),
    }).parse(request.body);

    const result = await createWebhook({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      url: body.url,
      events: body.events,
    });

    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem permissão." });
    if (result.kind === "invalid_url") {
      return reply.code(422).send({ message: "Webhook deve usar HTTPS público." });
    }
    return reply.code(201).send(result);
  });

  app.get("/v1/admin/webhooks", { preHandler: app.authenticate }, async (request, reply) => {
    const result = await listWebhooks({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
    });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem permissão." });
    return reply.send({ data: result.data });
  });

  app.delete("/v1/admin/webhooks/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const params = uuidParams.parse(request.params);
    const result = await disableWebhook({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      webhookId: params.id,
    });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem permissão." });
    if (result.kind === "not_found") return reply.code(404).send({ message: "Webhook não encontrado." });
    return reply.send({ disabled: true });
  });

  app.get("/v1/public-api/requests", async (request, reply) => {
    const auth = await authenticatePublicApiRequest(request, "requests:read");
    if (auth.kind !== "ok") return reply.code(401).send({ message: "API key inválida." });

    const query = z.object({
      status: z.string().max(40).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(request.query);

    const data = await withTenantTransaction(auth.tenantId, async (client) => {
      const result = await client.query(
        `SELECT id, origin_sector_id, destination_sector_id, assigned_to, title,
                due_at, status, competence, created_at, updated_at
           FROM requests
          WHERE ($1::text IS NULL OR status::text = $1)
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3`,
        [query.status ?? null, query.limit, query.offset],
      );
      return result.rows;
    });

    return reply.send({ data, pagination: { limit: query.limit, offset: query.offset } });
  });

  app.get("/v1/public-api/requests/:id", async (request, reply) => {
    const auth = await authenticatePublicApiRequest(request, "requests:read");
    if (auth.kind !== "ok") return reply.code(401).send({ message: "API key inválida." });
    const params = uuidParams.parse(request.params);

    const data = await withTenantTransaction(auth.tenantId, async (client) => {
      const requestResult = await client.query(
        `SELECT id, origin_sector_id, destination_sector_id, assigned_to, title,
                due_at, status, competence, instructions, created_at, updated_at
           FROM requests
          WHERE id = $1`,
        [params.id],
      );
      if (!requestResult.rows[0]) return null;

      const items = await client.query(
        `SELECT id, item_key, data, status, submitted_at, reviewed_at, updated_at
           FROM request_items
          WHERE request_id = $1
          ORDER BY created_at, item_key`,
        [params.id],
      );

      return { ...requestResult.rows[0], items: items.rows };
    });

    if (!data) return reply.code(404).send({ message: "Solicitação não encontrada." });
    return reply.send(data);
  });
}
